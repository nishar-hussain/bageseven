import { createHash } from 'node:crypto';
import { ArkivInvalidValueError, type Grant, type GrantStore } from '@bagseven/entitlements';
import { encodeFunctionData } from 'viem';
import { SubscriptionAbi } from '@bagseven/onchain';
import { platformFee, type CheckoutSession, type Plan } from './billing-store.js';
import type { SubscriptionStore } from './subscription-store.js';
import type { SubscriptionChain } from './subscription-chain.js';
import { checkoutKey, subscriptionId, subscriptionKey } from './subscription-chain.js';
import { RETRY_OFFSETS, COLLECTION_WINDOW, type Subscription, type SubscriptionPeriod } from './subscription-types.js';
import { usdtUnits } from './whitechain-payment.js';

const uuidFor = (value: string) => {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const seconds = () => Math.floor(Date.now() / 1000);

export class Subscriptions {
  constructor(readonly store: SubscriptionStore, private chain: SubscriptionChain, private grants: GrantStore, private clock = seconds) {}

  async prepare(plan: Plan) {
    if (plan.interval !== 'month' || plan.ttl_seconds !== 30 * 86400) throw Error('SUBSCRIPTION_PERIOD_INVALID: monthly plans use a fixed 30-day period');
    if (plan.provider_id === 'legacy') throw Error('PROVIDER_GAS_REQUIRED: recurring plans need an authorized provider');
    await this.chain.checkoutReady?.(plan.provider_id);
    const result = await this.store.lock(`plan:${plan.id}`, async () => {
      let saved = await this.store.plan(plan.id);
      if (!saved) {
        saved = await this.chain.preparePlan(plan);
        // Commit the exact signed bytes/hash before any broadcast can happen.
        await this.store.savePlan(saved);
      }
      if (saved.status !== 'ready') {
        if (await this.chain.verifyPlan(saved, plan)) {
          saved = { ...saved, status: 'ready', raw: undefined };
          await this.store.savePlan(saved);
        } else if (saved.raw) await this.chain.broadcast(saved.raw);
      }
      return saved;
    });
    if (!result) throw Error('SUBSCRIPTION_BUSY: plan preparation is in progress; retry this checkout');
    return result;
  }
  async planView(planId: string, checkoutId: string, expiresAt: string) {
    const plan = await this.store.plan(planId);
    return plan ? { status: plan.status, address: plan.contract, chain_id: plan.chainId,
      subscribe_data: encodeFunctionData({ abi: SubscriptionAbi, functionName: 'subscribe', args: [checkoutKey(checkoutId), BigInt(Math.floor(Date.parse(expiresAt) / 1000))] }) } : null;
  }
  async verifyCheckout(session: CheckoutSession, payer: string, hash: string) {
    const plan = await this.store.plan(session.plan_id);
    if (!plan || plan.status !== 'ready' || !session.plan) throw Error('SUBSCRIPTION_PLAN_NOT_READY');
    const payment = await this.chain.payment(hash, plan.contract, subscriptionKey(payer, session.id), session.plan, payer);
    if (!payment) throw Error('PAYMENT_PENDING: waiting for the subscription transaction to confirm');
    if (payment.paidAt > Math.floor(Date.parse(session.expires_at) / 1000)) throw Error('CHECKOUT_EXPIRED: subscription was paid after checkout expiry');
    if (payment.period !== 1) throw Error('SUBSCRIPTION_FIRST_PAYMENT_REQUIRED');
    return { payment, plan };
  }
  async completeCheckout(session: CheckoutSession, payer: string, hash: string, identity?: Grant | null) {
    const verified = await this.verifyCheckout(session, payer, hash);
    const result = await this.store.lock(subscriptionId(session.id), async () => {
      let sub = await this.store.get(subscriptionId(session.id));
      if (!sub) {
        sub = { id: subscriptionId(session.id), checkoutId: session.id, holder: session.holder, providerId: session.plan!.provider_id,
          plan: session.plan!, chainId: verified.plan.chainId, contract: verified.plan.contract, key: subscriptionKey(payer, session.id),
          payer, status: 'RECONCILIATION_REQUIRED', paidThrough: verified.payment.paidThrough, failures: 0,
          nextAttemptAt: verified.payment.paidThrough + RETRY_OFFSETS[0]!, grantId: '', paymentTx: hash,
          humanId: identity?.human_id, worldProofId: identity?.world_proof_id, workerId: session.worker_id || identity?.worker_id };
        await this.store.save(sub);
      }
      if (sub.paymentTx.toLowerCase() !== hash.toLowerCase() || sub.payer.toLowerCase() !== payer.toLowerCase()) throw Error('SUBSCRIPTION_CHECKOUT_CONFLICT');
      const id = `${sub.id}:initial`;
      let period = await this.store.period(id);
      if (!period) {
        period = { id, subscriptionId: sub.id, due: verified.payment.paidThrough - sub.plan.ttl_seconds,
          stage: 'confirmed', hash, raw: '', paidThrough: verified.payment.paidThrough, grantId: uuidFor(id) };
        await this.store.savePeriod(period);
      }
      return this.fulfill(sub, period);
    });
    if (!result) throw Error('SUBSCRIPTION_BUSY: checkout fulfillment is in progress');
    return result;
  }
  private async fulfill(sub: Subscription, period: SubscriptionPeriod): Promise<Grant> {
    const id = period.grantId ?? uuidFor(period.id);
    let grant = await this.grants.get(id);
    if (grant && (grant.payment_tx?.toLowerCase() !== period.hash.toLowerCase() || grant.holder !== sub.holder || grant.merchant !== sub.providerId)) throw Error('SUBSCRIPTION_GRANT_CONFLICT');
    if (!grant) {
      if (period.stage === 'minting' || period.stage === 'complete') throw Error('RECONCILIATION_REQUIRED: grant broadcast is unresolved; do not mint or charge again');
      const ttl = period.paidThrough! - this.clock();
      if (ttl <= 0) throw Error('RECONCILIATION_REQUIRED: paid period expired before fulfillment');
      await this.store.savePeriod({ ...period, stage: 'minting', grantId: id });
      try {
        grant = await this.grants.mint({ id, merchant: sub.providerId, holder: sub.holder, feature: sub.plan.feature,
          remaining: sub.plan.credits, ttl_seconds: ttl, renewal_enabled: sub.status !== 'CANCELLED', settlement_network: 'whitechain',
          payment_tx: period.hash, worker_id: sub.workerId, human_id: sub.humanId, world_proof_id: sub.worldProofId });
      } catch (error) {
        // Only a known pre-broadcast validation failure may retry a fresh write.
        if (error instanceof ArkivInvalidValueError) await this.store.savePeriod({ ...period, stage: 'confirmed', grantId: id });
        throw error;
      }
    }
    await this.store.savePeriod({ ...period, stage: 'complete', grantId: grant.id, raw: '', platformFeeAmount: period.id.endsWith(':initial') ? '0' : platformFee(sub.plan.amount) });
    await this.store.save({ ...sub, status: sub.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE', paidThrough: period.paidThrough!,
      grantId: grant.id, paymentTx: period.hash, failures: 0, lastError: undefined, nextAttemptAt: period.paidThrough! + RETRY_OFFSETS[0]! });
    return grant;
  }
  async syncCancellation(sub: Subscription) {
    const state = await this.chain.state(sub);
    if (state.payer.toLowerCase() !== sub.payer.toLowerCase()) throw Error('SUBSCRIPTION_PAYER_MISMATCH');
    if (state.cancelled) {
      const next: Subscription = { ...sub, status: 'CANCELLED', lastError: undefined };
      await this.store.save(next);
      // Keep payment/paidThrough intact; revoke only future renewal.
      if (sub.grantId && sub.paidThrough > this.clock()) {
        try {
          const grant = await this.grants.get(sub.grantId);
          if (grant?.renewal_enabled) await this.grants.cancelRenewal(sub.grantId);
        } catch {
          next.lastError = 'RENEWAL_FLAG_SYNC_PENDING: on-chain cancellation is confirmed; paid access is unchanged';
          await this.store.save(next);
        }
      }
      return next;
    }
    return sub;
  }
  async process(id: string) {
    return this.store.lock(id, async () => {
      let sub = await this.store.get(id);
      if (!sub || sub.status === 'ENDED') return;
      let period = await this.store.period(sub.grantId ? `${sub.id}:${sub.paidThrough}` : `${sub.id}:initial`);
      try {
        if (!period && !sub.grantId) {
          // Recover the committed subscription even if the process died before saving its first period.
          const payment = await this.chain.payment(sub.paymentTx, sub.contract, sub.key, sub.plan, sub.payer);
          if (!payment || payment.period !== 1 || payment.paidThrough !== sub.paidThrough) throw Error('RECONCILIATION_REQUIRED: initial payment must be verified and fulfilled before any renewal');
          const id = `${sub.id}:initial`;
          period = { id, subscriptionId: sub.id, due: payment.paidThrough - sub.plan.ttl_seconds,
            stage: 'confirmed', hash: sub.paymentTx, raw: '', paidThrough: payment.paidThrough, grantId: uuidFor(id) };
          await this.store.savePeriod(period);
        }
        if (!period && sub.grantId) {
          // Signing itself is durable: recover a crash before the per-subscription journal commit.
          const signed = await this.chain.recoverCharge?.(sub);
          if (signed) {
            period = { id: `${sub.id}:${sub.paidThrough}`, subscriptionId: sub.id, due: sub.paidThrough, stage: 'signed', ...signed };
            await this.store.savePeriod(period);
          }
        }
        // Recover a payment already signed or confirmed before checking fresh eligibility.
        // Cancellation cannot undo that payment; its purchased access still belongs to the payer.
        if (period && period.stage !== 'failed') {
          if (period.stage === 'complete' || period.stage === 'confirmed' || period.stage === 'minting') { await this.fulfill(sub, period); return; }
          const payment = await this.chain.payment(period.hash, sub.contract, sub.key, sub.plan, sub.payer);
          if (!payment) { await this.chain.broadcast(period.raw); return; }
          if (payment.paidThrough !== sub.paidThrough + sub.plan.ttl_seconds) throw Error('SUBSCRIPTION_PERIOD_MISMATCH');
          period = { ...period, stage: 'confirmed', paidThrough: payment.paidThrough, grantId: uuidFor(period.id) };
          await this.store.savePeriod(period);
          await this.fulfill(sub, period);
          return;
        }
        sub = await this.syncCancellation(sub);
        if (sub.status === 'CANCELLED' || this.clock() < sub.nextAttemptAt) return;
        if (this.clock() > sub.paidThrough + COLLECTION_WINDOW) {
          await this.store.save({ ...sub, status: 'ENDED', lastError: 'RENEWAL_WINDOW_ELAPSED: missed periods are never billed' }); return;
        }
        const state = await this.chain.state(sub);
        if (state.paidThrough !== sub.paidThrough) throw Error('RECONCILIATION_REQUIRED: chain and billing period differ');
        const amount = usdtUnits(sub.plan.amount);
        const reason = state.balance < amount ? 'INSUFFICIENT_FUNDS' : state.allowance < amount ? 'ALLOWANCE_REQUIRED' : undefined;
        if (reason) { await this.customerFailure(sub, reason); return; }
        const signed = await this.chain.signCharge(sub);
        period = { id: `${sub.id}:${sub.paidThrough}`, subscriptionId: sub.id, due: sub.paidThrough,
          stage: 'signed', ...signed };
        await this.store.savePeriod(period);
        await this.chain.broadcast(period.raw);
        await this.store.savePeriod({ ...period, stage: 'submitted' });
        // Receipt verification on the next tick also works after a daemon restart.
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason.includes('SUBSCRIPTION_TRANSACTION_REVERTED') && period) {
          await this.store.savePeriod({ ...period, stage: 'failed' });
        }
        const current = await this.store.get(id);
        if (!current) return;
        const reconciliation = /RECONCILIATION_REQUIRED|SUBSCRIPTION_GRANT_CONFLICT|SUBSCRIPTION_PERIOD_MISMATCH/.test(reason);
        await this.store.save({ ...current, status: reconciliation ? 'RECONCILIATION_REQUIRED' : current.status,
          lastError: reason, nextAttemptAt: this.clock() + 60,
          attempts: [...(current.attempts ?? []), { at: this.clock(), reason, paymentTx: period?.hash }].slice(-100) });
      }
    });
  }
  private async customerFailure(sub: Subscription, reason: string) {
    const failures = sub.failures + 1;
    await this.store.save({ ...sub, failures, status: failures >= 4 ? 'ENDED' : 'PAST_DUE', lastError: reason,
      nextAttemptAt: sub.paidThrough + (RETRY_OFFSETS[failures] ?? 86400),
      attempts: [...(sub.attempts ?? []), { at: this.clock(), reason }].slice(-100) });
  }
  async tick() {
    for (const sub of await this.store.list()) {
      if (sub.status !== 'ENDED' && (sub.nextAttemptAt <= this.clock() || sub.status === 'RECONCILIATION_REQUIRED')) await this.process(sub.id);
    }
  }
}
