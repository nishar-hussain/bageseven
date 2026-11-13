import { and, eq } from 'drizzle-orm';
import { x402Authorities, x402Jobs, type Database } from '@bagseven/db';
import { BagMandateAbi } from '@bagseven/onchain';
import type { GrantStore } from '@bagseven/entitlements';
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload } from '@x402/core/types';
import { encodeFunctionData, keccak256, parseAbi, recoverMessageAddress, stringToHex, type Hex } from 'viem';
import { X402Authorities } from './x402-authorities.js';
import { X402JobStore, type X402Job } from './x402-job-store.js';
import { X402Evidence } from './x402-evidence.js';
import { X402AuthorityTerms, x402AuthorityMessage, type JournaledAuthorization } from './x402-types.js';
import type { X402Requirements } from './x402.js';
import { usdtUnits } from './avalanche-payment.js';

export type X402Funding = (job: X402Job, hooks: {
  reserved: (reservationId: string) => Promise<void>;
  journal: (tx: Database, raw: Hex) => Promise<void>;
}) => Promise<{ decision: string; reservation_id?: string; tx_hash?: string; bound?: string; reason?: string }>;
export type X402Policy = { settle: (id: string, hash: string, recipient: string) => Promise<void>; release: (id: string) => Promise<void> };

/** Durable funding -> bounded authorization -> on-chain evidence -> credit finalization. */
export class X402Payments {
  readonly store: X402JobStore;
  readonly evidence: X402Evidence;
  private ticking = false;
  constructor(readonly authorities: X402Authorities, private grants: GrantStore,
    private fund: X402Funding, private policy: X402Policy, private fetcher: typeof fetch = fetch) {
    this.store = new X402JobStore(authorities.db);
    this.evidence = new X402Evidence(authorities.client, authorities.config.confirmations);
  }
  async prepare(provider: string, worker: string, url: string, requirement: X402Requirements, key: string, grantId?: string) {
    const { row, terms } = await this.authorities.active(provider, worker, requirement.payTo, new URL(url).origin);
    if (requirement.network !== `eip155:${terms.chain_id}` || requirement.asset.toLowerCase() !== terms.token ||
      requirement.scheme !== 'exact' || BigInt(requirement.amount) <= 0n || BigInt(requirement.amount) > usdtUnits(terms.max_amount)) throw Error('X402_AUTHORITY_SCOPE_MISMATCH');
    await this.authorities.network();
    const token = terms.token as Hex;
    const abi = parseAbi(['function name() view returns(string)', 'function version() view returns(string)']);
    const [name, version] = await Promise.all([
      this.authorities.client.readContract({ address: token, abi, functionName: 'name' }),
      this.authorities.client.readContract({ address: token, abi, functionName: 'version' }),
    ]);
    if ((requirement.extra?.name && requirement.extra.name !== name) || (requirement.extra?.version && requirement.extra.version !== version)) throw Error('X402_TOKEN_DOMAIN_MISMATCH');
    if (!await this.authorities.facilitator.supports(requirement)) throw Error('X402_FACILITATOR_INCOMPATIBLE');
    if (!row.authorizationSignature) throw Error('X402_APPROVAL_SIGNATURE_REQUIRED');
    return this.store.start(terms, key, { amount: requirement.amount, url, requirement, domain: { name, version }, grantId, authoritySignature: row.authorizationSignature });
  }
  private payload(job: X402Job, authorization: JournaledAuthorization): PaymentPayload {
    return { x402Version: 2, resource: { url: job.data.url }, accepted: job.data.requirement,
      payload: { signature: authorization.signature, authorization: {
        from: authorization.from, to: authorization.to, value: authorization.value,
        validAfter: authorization.validAfter, validBefore: authorization.validBefore, nonce: authorization.nonce,
      } } } as PaymentPayload;
  }
  private async revoked(job: X402Job) {
    const [authority] = await this.authorities.db.select().from(x402Authorities).where(eq(x402Authorities.id, job.authorityId));
    return !authority || authority.status !== 'active' || !authority.expiresAt || authority.expiresAt.getTime() <= Date.now() ||
      X402AuthorityTerms.parse(authority.authorization).nonce !== job.data.authority.nonce ||
      await this.authorities.client.readContract({ address: job.data.authority.mandate_contract as Hex, abi: BagMandateAbi, functionName: 'revoked' });
  }
  private hold(job: X402Job) { return `x402:${job.id}`; }
  /** Called inside the SAME transaction that reserves gas and commits the raw funding transaction. */
  private async journalFunding(tx: Database, job: X402Job, raw: Hex) {
    const hash = this.evidence.validateFundingBytes(job, raw);
    const [authority] = await tx.select().from(x402Authorities).where(eq(x402Authorities.id, job.authorityId)).for('update');
    if (!authority || authority.status !== 'active' || !authority.expiresAt || authority.expiresAt.getTime() <= Date.now() ||
      X402AuthorityTerms.parse(authority.authorization).nonce !== job.data.authority.nonce) throw Error('X402_PROVIDER_APPROVAL_REQUIRED');
    const [current] = await tx.select().from(x402Jobs).where(and(eq(x402Jobs.id, job.id), eq(x402Jobs.lease, job.lease))).for('update');
    if (!current || current.state !== 'FUNDING') throw Error('X402_JOB_CHANGED');
    const data = current.data as X402Job['data'];
    if (data.fundingHash && data.fundingHash !== hash) throw Error('X402_FUNDING_ALREADY_SIGNED');
    await tx.update(x402Jobs).set({ data: { ...data, fundingRaw: raw, fundingHash: hash } }).where(eq(x402Jobs.id, job.id));
  }
  private async sign(job: X402Job, refund: boolean) {
    const terms = job.data.authority;
    const now = await this.evidence.confirmedTime();
    const expires = refund ? now + 300 : Math.min(now + Math.min(300, job.data.requirement.maxTimeoutSeconds), Math.floor(terms.expires / 1000));
    if (expires <= now) throw Error('X402_PROVIDER_APPROVAL_EXPIRED');
    const nonce = keccak256(stringToHex(`${job.id}:${refund ? 'refund' : 'payment'}`));
    const authorization = { from: terms.payer as Hex, to: (refund ? terms.mandate_contract : terms.merchant) as Hex,
      value: BigInt(job.data.amount), validAfter: 0n, validBefore: BigInt(expires), nonce };
    return this.authorities.db.transaction(async tx => {
      const [authority] = await tx.select().from(x402Authorities).where(eq(x402Authorities.id, job.authorityId)).for('update');
      const [current] = await tx.select().from(x402Jobs).where(and(eq(x402Jobs.id, job.id), eq(x402Jobs.lease, job.lease))).for('update');
      if (!authority || !current) throw Error('X402_JOB_CHANGED');
      const stored = current.data as X402Job['data'];
      const prior = refund ? stored.refundAuthorization : stored.authorization;
      // Expired, unused refund authorizations can be renewed with the same nonce.
      // Confirmed expiry makes any older signature unable to race the replacement.
      if (prior && (!refund || now < Number(prior.validBefore))) return { ...current, data: stored, state: current.state as X402Job['state'] };
      if (!refund && (authority.status !== 'active' || !authority.expiresAt || authority.expiresAt.getTime() <= Date.now() ||
        X402AuthorityTerms.parse(authority.authorization).nonce !== terms.nonce)) throw Error('X402_PROVIDER_APPROVAL_REQUIRED');
      if (!stored.fundingBlock) throw Error('X402_CONFIRMED_FUNDING_REQUIRED');
      const signature = await this.authorities.keyring.sign(`${terms.provider}:${terms.id}`, authority.encryptedKey, authorization,
        { ...job.data.domain, chainId: terms.chain_id, verifyingContract: terms.token as Hex });
      const signed: JournaledAuthorization = { from: authorization.from, to: authorization.to,
        value: authorization.value.toString(), validAfter: '0', validBefore: String(expires), nonce, signature };
      const data = { ...stored, ...(refund ? { refundAuthorization: signed } : { authorization: signed }) };
      const state = refund ? 'REFUND_PENDING' : 'SIGNED';
      await tx.update(x402Jobs).set({ state, data }).where(eq(x402Jobs.id, job.id));
      return { ...current, data, state: state as X402Job['state'] };
    });
  }
  private async reject(job: X402Job, error: string) {
    job = await this.store.save(job, 'REJECTING', {}, error);
    if (job.data.reservationId) await this.policy.release(job.data.reservationId);
    if (job.data.grantId) {
      try { await this.grants.release(this.hold(job)); }
      catch (cause) { if (!/HOLD_NOT_FOUND/.test(String(cause))) throw cause; }
    }
    return this.store.save(job, 'REJECTED', {}, error);
  }
  private async finalize(job: X402Job, refund: boolean) {
    if (job.data.grantId) {
      if (refund) await this.grants.release(this.hold(job));
      else await this.grants.commit(this.hold(job));
    }
    // Funding consumed the vault's on-chain quota even if the tokens were later returned.
    return this.store.save(job, refund ? 'REFUNDED' : 'SETTLED');
  }
  private async locate(job: X402Job, refund: boolean) {
    const known = refund ? job.data.refundHash : job.data.settlementHash;
    if (known && await this.evidence.settlement(job, known as Hex, refund)) return known as Hex;
    const found = await this.evidence.locateAuthorization(job, refund);
    if (found.hash && await this.evidence.settlement(job, found.hash, refund)) return found.hash;
    if (found.scannedTo !== undefined) await this.store.save(job, job.state,
      refund ? { refundScanBlock: found.scannedTo.toString() } : { paymentScanBlock: found.scannedTo.toString() });
    if (found.used) throw Error('X402_SETTLEMENT_RECONCILIATION_REQUIRED: authorization consumed; locate its confirmed transfer before continuing');
    return undefined;
  }
  async process(id: string) {
    return this.store.lock(id, async () => {
      let job = await this.store.get(id);
      if (!job || ['SETTLED', 'REFUNDED', 'REJECTED'].includes(job.state)) return;
      try {
        await this.authorities.network();
        const approvedBy = await recoverMessageAddress({ message: x402AuthorityMessage(job.data.authority), signature: job.data.authoritySignature as Hex });
        if (approvedBy.toLowerCase() !== job.data.authority.owner) throw Error('X402_APPROVAL_SIGNATURE_INVALID');
        if (job.state === 'PAID') { await this.finalize(job, false); return; }
        if (job.state === 'RETURNED') { await this.finalize(job, true); return; }
        if (job.state === 'REJECTING') { await this.reject(job, job.lastError || 'Rejected'); return; }
        if (!job.data.fundingRaw) {
          if (await this.revoked(job)) { await this.reject(job, 'X402_AUTHORITY_OR_MANDATE_REVOKED'); return; }
          // Atomic funding journaling proves no transaction escaped when raw bytes are absent.
          if (job.data.reservationId) {
            await this.policy.release(job.data.reservationId);
            job = await this.store.save(job, job.state, { reservationId: undefined });
          }
          if (job.data.grantId && !job.data.holdApplied) {
            const grant = await this.grants.get(job.data.grantId);
            if (!grant || (grant.worker_id && grant.worker_id !== job.data.authority.worker_id) ||
              (!grant.worker_id && grant.holder.toLowerCase() !== job.data.authority.owner)) throw Error('X402_GRANT_BINDING_MISMATCH');
            await this.grants.hold(grant.id, '1', this.hold(job));
            job = await this.store.save(job, job.state, { holdApplied: true });
          }
          if (job.data.grantId) {
            const grant = await this.grants.get(job.data.grantId);
            const chainNow = Number((await this.authorities.client.getBlock()).timestamp) * 1000;
            // A reserved last credit is valid, but expired/disabled access cannot fund a new payment.
            if (!grant?.enabled || Date.parse(grant.paid_through) <= Math.max(Date.now(), chainNow)) {
              await this.reject(job, 'X402_GRANT_NO_LONGER_LIVE'); return;
            }
          }
          job = await this.store.save(job, 'FUNDING');
          const result = await this.fund(job, {
            reserved: async reservationId => { job = await this.store.save(job!, 'FUNDING', { reservationId }); },
            journal: (tx, raw) => this.journalFunding(tx, job!, raw),
          });
          job = (await this.store.get(id))!;
          if (result.decision !== 'allow') { await this.reject(job, String(result.bound || result.reason || 'X402_MANDATE_DENIED')); return; }
          if (!job.data.fundingRaw) throw Error('X402_FUNDING_JOURNAL_REQUIRED');
        }
        if (!job.data.fundingBlock) {
          const funding = await this.evidence.funding(job);
          if (!funding) {
            // Exact bytes only, never another funding payment or nonce.
            try { await this.authorities.client.sendRawTransaction({ serializedTransaction: job.data.fundingRaw as Hex }); }
            catch (error) { if (!/already known|known transaction|nonce too low/i.test(String(error))) throw error; }
            await this.store.save(job, 'FUNDING'); return;
          }
          if (job.data.reservationId) await this.policy.settle(job.data.reservationId, job.data.fundingHash!, job.data.authority.payer);
          job = await this.store.save(job, 'FUNDED', { fundingBlock: funding.blockNumber.toString() });
        }
        const settled = await this.locate(job, false);
        if (settled) { job = await this.store.save(job, 'PAID', { settlementHash: settled }); await this.finalize(job, false); return; }
        const now = await this.evidence.confirmedTime();
        const shouldRefund = job.data.authorization
          ? now >= Number(job.data.authorization.validBefore)
          : await this.revoked(job);
        if (shouldRefund) {
          const refunded = await this.locate(job, true);
          if (refunded) { job = await this.store.save(job, 'RETURNED', { refundHash: refunded }); await this.finalize(job, true); return; }
          if (!job.data.refundAuthorization || now >= Number(job.data.refundAuthorization.validBefore)) job = await this.sign(job, true);
          const requirement: X402Requirements = { ...job.data.requirement, payTo: job.data.authority.mandate_contract as Hex, maxTimeoutSeconds: 300 };
          const result = await this.authorities.facilitator.settle(this.payload({ ...job, data: { ...job.data, requirement } }, job.data.refundAuthorization!), requirement);
          await this.store.save(job, 'REFUND_PENDING', { refundHash: result.transaction });
          return;
        }
        if (!job.data.authorization) job = await this.sign(job, false);
        const payload = this.payload(job, job.data.authorization!);
        await this.authorities.facilitator.verify(payload, job.data.requirement);
        // Journaled signature precedes every external operation, including /verify above.
        job = await this.store.save(job, 'SUBMITTED');
        const response = await this.fetcher(job.data.url, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload), 'idempotency-key': job.id },
          signal: AbortSignal.timeout(15000), redirect: 'error' });
        const body = (await response.text()).slice(0, 10000);
        let hash: string | undefined;
        const header = response.headers.get('payment-response');
        if (header) {
          try { const evidence = decodePaymentResponseHeader(header); if (/^0x[\da-f]{64}$/i.test(evidence.transaction)) hash = evidence.transaction; } catch { /* On-chain reconciliation is authoritative. */ }
        }
        job = await this.store.save(job, 'SUBMITTED', { providerStatus: response.status, providerBody: body, settlementHash: hash });
        const paid = await this.locate(job, false);
        if (paid) { job = await this.store.save(job, 'PAID', { settlementHash: paid }); await this.finalize(job, false); }
      } catch (error) {
        const current = await this.store.get(id);
        if (!current || current.lease !== job?.lease) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('X402_FUNDING_REVERTED')) { await this.reject(current, message); return; }
        await this.store.save(current, 'RECONCILIATION_REQUIRED', {}, message);
      }
    });
  }
  async view(id: string) {
    const job = await this.store.get(id);
    if (!job) throw Error('X402_PAYMENT_NOT_FOUND');
    return { x402_job_id: id, status: job.state, decision: job.state === 'SETTLED' ? 'allow' : ['REFUNDED', 'REJECTED'].includes(job.state) ? 'refused' : 'pending',
      executed: job.state === 'SETTLED', merchant: job.data.authority.merchant, payer: job.data.authority.payer,
      chain_id: job.data.authority.chain_id, token: job.data.authority.token, amount_atomic: job.data.amount,
      funding_tx: job.data.fundingHash ?? null, payment_tx: job.data.settlementHash ?? null, refund_tx: job.data.refundHash ?? null,
      authorization_expires: job.data.authorization?.validBefore ?? null, last_error: job.lastError ?? null,
      provider: job.data.providerStatus ? { status: job.data.providerStatus, body: job.data.providerBody } : null,
      note: 'Funding is enforced by the on-chain mandate. Refunds return only to that mandate and do not reset its spent counters.' };
  }
  async recoveryDraft(id: string) {
    const job = await this.store.get(id);
    if (!job?.data.refundAuthorization) throw Error('X402_RECOVERY_NOT_READY: reconcile the original authorization first');
    const a = job.data.refundAuthorization;
    const signature = a.signature.slice(2);
    const data = encodeFunctionData({ abi: parseAbi(['function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)']),
      functionName: 'transferWithAuthorization', args: [a.from as Hex, a.to as Hex, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore),
        a.nonce as Hex, parseInt(signature.slice(128, 130), 16), `0x${signature.slice(0, 64)}`, `0x${signature.slice(64, 128)}`] });
    return { chain_id: job.data.authority.chain_id, transaction: { to: job.data.authority.token, data, value: '0x0' },
      note: 'Review this transaction in your provider wallet. It returns only the authorized unused amount to the original mandate.' };
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try { const jobs = await this.store.due(); for (let i = 0; i < jobs.length; i += 2) await Promise.all(jobs.slice(i, i + 2).map(j => this.process(j.id))); }
    finally { this.ticking = false; }
  }
}
