import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { createDb, entitlementRecords, type Database } from '@bagseven/db';
import { avalancheConfig, EntitlementRegistryAbi, ProviderGasManager } from '@bagseven/onchain';
import { createPublicClient, createWalletClient, encodeFunctionData, formatUnits, http, isAddress, keccak256, parseUnits, stringToHex, type Hex } from 'viem';
import { validateMoney } from '@bagseven/money';
import { providerGrantSigner } from './provider-signers.js';
import { GrantSchema, MintGrantInputSchema, type Grant, type GrantStore, type MintGrantInput } from './types.js';

const abi = EntitlementRegistryAbi;
const hash = (value: string) => keccak256(stringToHex(value));

/** SQL discovers private subjects and pending writes; the registry authorizes every balance read. */
export class AvalancheGrantStore implements GrantStore {
  private readonly config;
  private readonly registry: Hex;
  private readonly client;
  constructor(private db: Database, private env: NodeJS.ProcessEnv) {
    this.config = avalancheConfig(env);
    if (!isAddress(env.AVALANCHE_ENTITLEMENT_REGISTRY ?? '') || !env.ENTITLEMENT_SUBJECT_SECRET) {
      throw Error('AVALANCHE_REGISTRY_NOT_CONFIGURED: configure the registry and private subject hashing secret');
    }
    this.registry = env.AVALANCHE_ENTITLEMENT_REGISTRY!.toLowerCase() as Hex;
    this.client = createPublicClient({ chain: this.config.chain, transport: http(this.config.rpcUrl) });
  }
  static fromEnv(env: NodeJS.ProcessEnv) {
    if (!env.DATABASE_URL) throw Error('AVALANCHE_REGISTRY_NOT_CONFIGURED: DATABASE_URL is required');
    return new AvalancheGrantStore(createDb({ connectionString: env.DATABASE_URL }), env);
  }
  private key(id: string) { return `${this.config.chainId}:${this.registry}:${id}`; }
  private async row(id: string) {
    return this.db.query.entitlementRecords.findFirst({ where: eq(entitlementRecords.key, this.key(id)) });
  }
  private async record(id: string, kind: string, provider: string, data: unknown) {
    await this.db.insert(entitlementRecords).values({ key: this.key(id), chainId: this.config.chainId,
      registry: this.registry, providerId: provider, kind, data }).onConflictDoNothing();
    return (await this.row(id))!;
  }
  private async network() {
    if (await this.client.getChainId() !== this.config.chainId) throw Error('AVALANCHE_RPC_CHAIN_MISMATCH');
  }
  private async write(provider: string, data: Hex) {
    await this.network();
    const account = await providerGrantSigner(provider);
    const wallet = createWalletClient({ account, chain: this.config.chain, transport: http(this.config.rpcUrl) });
    const gas = new ProviderGasManager(this.db, this.env);
    const prior = await gas.signedSubscription(provider, this.config.chainId, data, this.registry);
    const raw = prior ?? await wallet.signTransaction(await wallet.prepareTransactionRequest({
      account, to: this.registry, data, value: 0n,
    }));
    const tx = keccak256(raw);
    const mined = await this.client.getTransactionReceipt({ hash: tx }).catch(() => null);
    if (!mined) await this.client.sendRawTransaction({ serializedTransaction: raw });
    const receipt = await this.client.waitForTransactionReceipt({ hash: tx, confirmations: this.config.confirmations });
    if (receipt.status !== 'success') {
      await gas.revertedSubscription(provider, this.config.chainId, raw);
      throw Error('ENTITLEMENT_TRANSACTION_REVERTED');
    }
  }
  private subject(value: string): Hex {
    return `0x${createHmac('sha256', this.env.ENTITLEMENT_SUBJECT_SECRET!).update(value).digest('hex')}`;
  }
  async mint(raw: MintGrantInput): Promise<Grant> {
    const input = MintGrantInputSchema.parse(raw);
    validateMoney(input.remaining);
    const amount = parseUnits(input.remaining, 18);
    if (amount <= 0n || amount >= 2n ** 128n) throw Error('INVALID_AMOUNT');
    if (!input.merchant) throw Error('PROVIDER_GAS_REQUIRED');
    const id = input.id ?? randomUUID();
    const created = new Date().toISOString();
    const proposed: Grant = GrantSchema.parse({ ...input, id, enabled: true, schema_version: 1,
      created_at: created, updated_at: created, paid_through: new Date(Date.now() + input.ttl_seconds * 1000).toISOString() });
    const saved = await this.record(hash(id), 'grant', input.merchant, proposed);
    const grant = GrantSchema.parse(saved.data);
    if (grant.holder !== input.holder || grant.feature !== input.feature || grant.payment_tx !== input.payment_tx ||
      grant.remaining !== input.remaining || saved.providerId !== input.merchant) throw Error('GRANT_ID_CONFLICT');
    const existing = await this.get(id);
    if (existing) return existing;
    const signer = await providerGrantSigner(input.merchant);
    await this.write(input.merchant, encodeFunctionData({ abi, functionName: 'issue', args: [hash(id), signer.address,
      this.subject(grant.holder), hash(grant.feature), amount, BigInt(Math.floor(new Date(grant.paid_through).getTime() / 1000)), grant.renewal_enabled] }));
    return (await this.get(id))!;
  }
  async get(id: string): Promise<Grant | null> {
    const row = await this.row(hash(id));
    if (!row || row.kind !== 'grant') return null;
    await this.network();
    return this.readGrant(GrantSchema.parse(row.data));
  }
  private async readGrant(metadata: Grant): Promise<Grant | null> {
    const id = metadata.id;
    const value = await this.client.readContract({ address: this.registry, abi, functionName: 'grants', args: [hash(id)] });
    if (value[0] === '0x0000000000000000000000000000000000000000') return null;
    if (value[1] !== this.subject(metadata.holder) || value[2] !== hash(metadata.feature)) throw Error('ENTITLEMENT_METADATA_MISMATCH');
    return { ...metadata, remaining: formatUnits(value[3], 18), paid_through: new Date(Number(value[4]) * 1000).toISOString(),
      renewal_enabled: value[5], enabled: value[6], registry_address: this.registry, registry_grant_id: hash(id) };
  }
  async findLive(query: { holder?: string; feature?: string; worker_id?: string }) {
    const rows = await this.db.select().from(entitlementRecords).where(and(eq(entitlementRecords.chainId, this.config.chainId),
      eq(entitlementRecords.registry, this.registry), eq(entitlementRecords.kind, 'grant'),
      query.holder ? sql`${entitlementRecords.data}->>'holder' = ${query.holder}` : undefined,
      query.feature ? sql`${entitlementRecords.data}->>'feature' = ${query.feature}` : undefined,
      query.worker_id ? sql`${entitlementRecords.data}->>'worker_id' = ${query.worker_id}` : undefined,
      sql`${entitlementRecords.data}->>'paid_through' > ${new Date().toISOString()}`));
    if (!rows.length) return [];
    await this.network();
    const result: Grant[] = [];
    // Bounded concurrency avoids serial RPC latency without overwhelming the node.
    for (let offset = 0; offset < rows.length; offset += 8) {
      const grants = await Promise.all(rows.slice(offset, offset + 8).map(row => this.readGrant(GrantSchema.parse(row.data))));
      for (const grant of grants) {
        if (grant?.enabled && new Date(grant.paid_through).getTime() > Date.now()) result.push(grant);
      }
    }
    return result;
  }
  private async required(id: string) {
    const grant = await this.get(id);
    if (!grant) throw Error('GRANT_NOT_FOUND');
    return grant;
  }
  private assertSpendable(grant: Grant, amount: string) {
    if (!grant.enabled) throw Error('GRANT_DISABLED');
    if (new Date(grant.paid_through).getTime() <= Date.now()) throw Error('GRANT_EXPIRED');
    const units = parseUnits(amount, 18);
    if (units <= 0n || units >= 2n ** 128n) throw Error('INVALID_AMOUNT');
    if (parseUnits(grant.remaining, 18) < units) throw Error('GRANT_EMPTY');
  }
  async consume(id: string, amount: string, operation: string) {
    validateMoney(amount);
    const grant = await this.required(id);
    const previous = await this.client.readContract({ address: this.registry, abi, functionName: 'consumptions', args: [hash(id), hash(operation)] });
    if (previous) {
      const used = await this.client.readContract({ address: this.registry, abi, functionName: 'consumptionAmounts', args: [hash(id), hash(operation)] });
      if (used !== parseUnits(amount, 18)) throw Error('IDEMPOTENCY_CONFLICT');
      return grant;
    }
    this.assertSpendable(grant, amount);
    await this.write(grant.merchant!, encodeFunctionData({ abi, functionName: 'consume', args: [hash(id), parseUnits(amount, 18), hash(operation)] }));
    return this.required(id);
  }
  async cancelRenewal(id: string) {
    const grant = await this.required(id);
    await this.write(grant.merchant!, encodeFunctionData({ abi, functionName: 'cancelRenewal', args: [hash(id)] }));
    return this.required(id);
  }
  async hold(id: string, amount: string, operation: string) {
    validateMoney(amount);
    const grant = await this.required(id);
    const row = await this.record(hash(operation), 'hold', grant.merchant!, { id, amount });
    const prior = row.data as { id: string; amount: string };
    if (row.kind !== 'hold' || prior.id !== id || prior.amount !== amount) throw Error('HOLD_EXISTS');
    const existing = await this.client.readContract({ address: this.registry, abi, functionName: 'holds', args: [hash(operation)] });
    if (existing[2] === 0) this.assertSpendable(grant, amount);
    await this.write(grant.merchant!, encodeFunctionData({ abi, functionName: 'hold', args: [hash(id), parseUnits(amount, 18), hash(operation)] }));
    return this.required(id);
  }
  private async finalize(operation: string, release: boolean) {
    const row = await this.row(hash(operation));
    if (!row || row.kind !== 'hold') throw Error('HOLD_NOT_FOUND');
    const { id } = row.data as { id: string };
    await this.write(row.providerId, encodeFunctionData({ abi, functionName: 'finalizeHold', args: [hash(operation), release] }));
    return this.required(id);
  }
  commit(operation: string) { return this.finalize(operation, false); }
  release(operation: string) { return this.finalize(operation, true); }
  describe() { return { mode: 'avalanche' as const, live: true, rpcUrl: this.config.rpcUrl, registry: this.registry }; }
}
