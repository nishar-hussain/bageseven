import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { agents, mandates, x402Authorities, type Database } from '@bagseven/db';
import { avalancheConfig, ProviderGasManager, BagMandateAbi } from '@bagseven/onchain';
import { createPublicClient, http, parseAbi, recoverMessageAddress, type Hex, type PublicClient } from 'viem';
import { X402ApprovalInput, X402AuthorityTerms, x402AuthorityMessage } from './x402-types.js';
import { EncryptedX402Keyring, type X402Keyring } from './x402-keyring.js';
import { StandardV2Facilitator, type X402Facilitator } from './x402-facilitator.js';
import { usdtUnits } from './avalanche-payment.js';

export class X402Authorities {
  readonly keyring: X402Keyring;
  readonly facilitator: X402Facilitator;
  readonly config;
  readonly client: PublicClient;
  constructor(readonly db: Database, readonly env: NodeJS.ProcessEnv, options: { keyring?: X402Keyring; facilitator?: X402Facilitator } = {}) {
    this.config = avalancheConfig(env);
    this.client = createPublicClient({ chain: this.config.chain, transport: http(this.config.rpcUrl) });
    this.keyring = options.keyring ?? new EncryptedX402Keyring(env);
    this.facilitator = options.facilitator ?? new StandardV2Facilitator(env.X402_FACILITATOR_URL || 'https://facilitator.payai.network');
  }
  async network() { if (await this.client.getChainId() !== this.config.chainId) throw Error('X402_CHAIN_MISMATCH'); }
  async prepare(provider: string, raw: unknown) {
    const input = X402ApprovalInput.parse(raw);
    const origin = new URL(input.provider_origin);
    const local = this.env.NODE_ENV !== 'production' && this.env.DEV_MODE === 'true' && ['localhost', '127.0.0.1'].includes(origin.hostname);
    if ((origin.protocol !== 'https:' && !local) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw Error('X402_PROVIDER_ORIGIN_REQUIRED');
    if (input.expires <= Date.now() + 60000 || input.expires > Date.now() + 365 * 86400000) throw Error('X402_AUTHORITY_EXPIRATION_INVALID');
    const mandate = await this.db.query.mandates.findFirst({ where: eq(mandates.id, input.mandate_id) });
    const worker = await this.db.query.agents.findFirst({ where: eq(agents.id, input.worker_id) });
    if (!mandate?.contractAddress || mandate.providerId !== provider || mandate.status !== 'active' ||
      worker?.mandateId !== mandate.id || worker.status !== 'active') throw Error('X402_MANDATE_BINDING_REQUIRED');
    await this.network();
    const gas = await new ProviderGasManager(this.db, this.env).assertActive(provider);
    const contract = mandate.contractAddress as Hex;
    const read = (functionName: 'owner' | 'usdc' | 'enforcer' | 'revoked' | 'perPurchaseCap') =>
      this.client.readContract({ address: contract, abi: BagMandateAbi, functionName });
    const [owner, token, enforcer, revoked, cap] = await Promise.all([read('owner'), read('usdc'), read('enforcer'), read('revoked'), read('perPurchaseCap')]);
    if (revoked || String(owner).toLowerCase() !== mandate.ownerAddress || String(token).toLowerCase() !== this.config.usdt.toLowerCase() ||
      String(enforcer).toLowerCase() !== gas.address) throw Error('X402_MANDATE_CHAIN_TERMS_MISMATCH');
    if (usdtUnits(input.max_amount) <= 0n || usdtUnits(input.max_amount) > BigInt(cap)) throw Error('X402_AMOUNT_EXCEEDS_MANDATE');
    // Probe the configured token rather than trusting a merchant-supplied EIP-712 domain.
    const tokenAbi = parseAbi(['function name() view returns(string)', 'function version() view returns(string)', 'function DOMAIN_SEPARATOR() view returns(bytes32)', 'function authorizationState(address,bytes32) view returns(bool)']);
    await Promise.all([
      this.client.readContract({ address: token as Hex, abi: tokenAbi, functionName: 'name' }),
      this.client.readContract({ address: token as Hex, abi: tokenAbi, functionName: 'version' }),
      this.client.readContract({ address: token as Hex, abi: tokenAbi, functionName: 'DOMAIN_SEPARATOR' }),
      this.client.readContract({ address: token as Hex, abi: tokenAbi, functionName: 'authorizationState', args: [owner as Hex, `0x${'00'.repeat(32)}`] }),
    ]);
    if (!await this.facilitator.supports({ x402Version: 2, scheme: 'exact', network: `eip155:${this.config.chainId}`,
      asset: token as Hex, payTo: input.merchant as Hex, amount: usdtUnits(input.max_amount).toString(), maxTimeoutSeconds: 300 })) throw Error('X402_FACILITATOR_INCOMPATIBLE');
    const binding = and(eq(x402Authorities.providerId, provider), eq(x402Authorities.mandateId, mandate.id),
      eq(x402Authorities.workerId, worker.id), eq(x402Authorities.chainId, this.config.chainId), eq(x402Authorities.merchant, input.merchant));
    let [row] = await this.db.select().from(x402Authorities).where(binding);
    if (!row) {
      const id = randomUUID();
      const key = await this.keyring.create(`${provider}:${id}`);
      await this.db.insert(x402Authorities).values({ id, providerId: provider, mandateId: mandate.id, workerId: worker.id,
        chainId: this.config.chainId, merchant: input.merchant, ownerAddress: mandate.ownerAddress,
        payerAddress: key.address.toLowerCase(), encryptedKey: key.reference, status: 'pending' }).onConflictDoNothing();
      [row] = await this.db.select().from(x402Authorities).where(binding);
    }
    if (!row || row.ownerAddress !== mandate.ownerAddress) throw Error('X402_OWNER_MISMATCH');
    const terms = X402AuthorityTerms.parse({ kind: 'bagseven_x402_authority_v1', id: row.id, provider, owner,
      mandate_id: mandate.id, mandate_contract: contract, worker_id: worker.id, chain_id: this.config.chainId,
      token, payer: row.payerAddress, merchant: input.merchant, provider_origin: origin.origin,
      facilitator: this.facilitator.url, max_amount: input.max_amount, expires: input.expires,
      nonce: randomUUID(), challenge_expires: Date.now() + 300000 });
    await this.db.update(x402Authorities).set({ challenge: terms }).where(eq(x402Authorities.id, row.id));
    return { authority_id: row.id, terms, message: x402AuthorityMessage(terms) };
  }
  async authorize(provider: string, id: string, signature: Hex) {
    const [row] = await this.db.select().from(x402Authorities).where(and(eq(x402Authorities.id, id), eq(x402Authorities.providerId, provider)));
    if (!row?.challenge) throw Error('X402_AUTHORITY_CHALLENGE_REQUIRED');
    const terms = X402AuthorityTerms.parse(row.challenge);
    if (terms.challenge_expires <= Date.now() || terms.expires <= Date.now()) throw Error('X402_AUTHORITY_CHALLENGE_EXPIRED');
    const owner = await recoverMessageAddress({ message: x402AuthorityMessage(terms), signature });
    if (owner.toLowerCase() !== row.ownerAddress || terms.owner !== row.ownerAddress) throw Error('X402_AUTHORITY_SIGNATURE_INVALID');
    const updated = await this.db.update(x402Authorities).set({ status: 'active', authorization: terms, authorizationSignature: signature, challenge: null, expiresAt: new Date(terms.expires) })
      .where(and(eq(x402Authorities.id, id), sql`${x402Authorities.challenge}->>'nonce' = ${terms.nonce}`)).returning();
    if (!updated.length) throw Error('X402_AUTHORITY_CHALLENGE_USED');
    return { id, payer: row.payerAddress, expires: terms.expires, status: 'active' };
  }
  async revoke(provider: string, id: string) {
    const rows = await this.db.update(x402Authorities).set({ status: 'revoked', challenge: null })
      .where(and(eq(x402Authorities.id, id), eq(x402Authorities.providerId, provider))).returning({ id: x402Authorities.id });
    if (!rows.length) throw Error('X402_AUTHORITY_NOT_FOUND');
    return { id, status: 'revoked', note: 'New signing stopped. Already-issued signatures may settle until expiry; unused funding returns only to its original mandate.' };
  }
  async active(provider: string, worker: string, merchant: string, origin: string) {
    const [row] = await this.db.select().from(x402Authorities).where(and(eq(x402Authorities.providerId, provider),
      eq(x402Authorities.workerId, worker), eq(x402Authorities.merchant, merchant.toLowerCase()), eq(x402Authorities.chainId, this.config.chainId)));
    if (!row || row.status !== 'active' || !row.authorization || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) throw Error('X402_PROVIDER_APPROVAL_REQUIRED');
    const terms = X402AuthorityTerms.parse(row.authorization);
    if (terms.provider_origin !== origin || terms.facilitator !== this.facilitator.url || terms.token !== this.config.usdt.toLowerCase()) throw Error('X402_AUTHORITY_SCOPE_MISMATCH');
    return { row, terms };
  }
}
