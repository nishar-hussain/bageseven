import { randomUUID } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { and, eq, gt } from '@arkiv-network/sdk/query';
import { dec } from '@arkiv-network/sdk/schema';
import { add, gte, gt as moneyGt, sub, validateMoney } from '@bagseven/money';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { BagsevenGrants } from './schema.js';
import type { Grant, GrantStore, MintGrantInput } from './types.js';
import { MintGrantInputSchema } from './types.js';
import { providerGrantSigner } from './provider-signers.js';
import { decodeGrantIdentities, encodeGrantIdentities, identityIndex } from './grant-identities.js';

interface HoldRecord {
  holdId: string;
  grantId: string;
  amount: string;
}

export interface ArkivStoreConfig {
  accessKey: string;
  privateKey?: Hex;
  providerFunded?: boolean;
  rpcUrl?: string;
}

/** Preserve custom RPC paths; attach the access key to the public Rabdi base URL. */
export function arkivTransportUrl(rpcUrl: string, accessKey: string): string {
  const url = new URL(rpcUrl);
  if (url.hostname === 'rpc.rabdi.db-chain.testnet.arkiv.network' && url.pathname === '/') {
    url.pathname = `/${encodeURIComponent(accessKey)}`;
  }
  return url.toString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(grant: Grant, at = Date.now()): boolean {
  return new Date(grant.paid_through).getTime() <= at;
}

function assertLive(grant: Grant): void {
  if (!grant.enabled) throw new Error('GRANT_DISABLED: grant is disabled');
  if (isExpired(grant)) {
    throw new Error('GRANT_EXPIRED: paid_through has passed; access left the query surface');
  }
}

function flag(v: boolean): string {
  return v ? 'true' : 'false';
}

function normalizeSettlement(raw: string | undefined): Grant['settlement_network'] {
  if (raw === 'local') return 'local';
  return 'whitechain';
}

function parseFlag(v: string | undefined): boolean {
  return v === 'true';
}

function bareStr(v: { value: string } | string | undefined | null): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v.value;
}

function bareDec(v: { value: string } | string | undefined | null): string {
  if (v == null) return '0';
  if (typeof v === 'string') return v;
  return v.value;
}

/**
 * Live Arkiv-backed grant store.
 *
 * Writes entities through `BagsevenGrants` with `ExpirationTime.fromSeconds(ttl)`.
 * Missing credentials fail closed; offline tests use MemoryGrantStore explicitly.
 */
export class ArkivGrantStore implements GrantStore {
  private readonly config: ArkivStoreConfig | null;
  private readonly rpcUrl: string;
  private readonly cache = new Map<string, Grant>();
  private readonly entityKeys = new Map<string, Hex>();
  private readonly entityOwners = new Map<string, string>();
  private readonly holds = new Map<string, HoldRecord>();
  private readonly consumedKeys = new Set<string>();
  private readonly consumeSnapshots = new Map<string, Grant>();
  private wallet: ReturnType<typeof createWalletClient> | null = null;
  private public: ReturnType<typeof createPublicClient> | null = null;
  private live = false;

  constructor(rpcUrlOrConfig?: string | ArkivStoreConfig, maybeConfig?: ArkivStoreConfig) {
    const config = typeof rpcUrlOrConfig === 'object' ? rpcUrlOrConfig : maybeConfig;
    if (!config?.accessKey || (!config.providerFunded && (!config.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(config.privateKey)))) {
      throw new Error('ARKIV_NOT_CONFIGURED: set ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY; live storage never falls back to memory');
    }
    this.config = config;
    this.rpcUrl = config.rpcUrl ?? (typeof rpcUrlOrConfig === 'string' ? rpcUrlOrConfig : 'https://rpc.rabdi.db-chain.testnet.arkiv.network');
    this.live = true;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ArkivGrantStore {
    if (env.NODE_ENV === 'production' && env.PROVIDER_FUNDED_GAS === 'false') throw new Error('PROVIDER_GAS_REQUIRED: platform-funded storage is forbidden in production');
    return new ArkivGrantStore({
      accessKey: env.ARKIV_ACCESS_KEY ?? '',
      privateKey: (env.ARKIV_PRIVATE_KEY ?? env.PRIVATE_KEY ?? '') as Hex,
      providerFunded: env.PROVIDER_FUNDED_GAS !== 'false',
      rpcUrl: env.ARKIV_RPC_URL,
    });
  }

  private ensureClients(): void {
    if (!this.live || !this.config) {
      throw new Error('ARKIV_NOT_CONFIGURED: set ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY');
    }
    if (this.public) return;
    const chain = rabdi({ accessKey: this.config.accessKey });
    if (!this.config.providerFunded) this.wallet = createWalletClient({
      account: privateKeyToAccount(this.config.privateKey!), chain,
      transport: http(arkivTransportUrl(this.rpcUrl, this.config.accessKey), { timeout: 15_000, retryCount: 1 }),
    });
    this.public = createPublicClient({
      chain,
      transport: http(arkivTransportUrl(this.rpcUrl, this.config.accessKey), { timeout: 15_000, retryCount: 1 }),
    });
  }

  private async walletFor(provider?: string, entityKey?: Hex) {
    this.ensureClients();
    if (!this.config!.providerFunded) return this.wallet!;
    const account = await providerGrantSigner(provider);
    if (entityKey) {
      let owner = this.entityOwners.get(entityKey);
      if (!owner) {
        const entity = await this.public!.getEntity(entityKey, BagsevenGrants);
        owner = entity.$owner;
        if (owner) this.entityOwners.set(entityKey, owner);
      }
      if (!owner || owner.toLowerCase() !== account.address.toLowerCase()) throw new Error('PROVIDER_GAS_ENTITY_OWNER_MISMATCH: this legacy grant must be migrated or reissued by its provider; platform signing fallback is disabled');
    }
    return createWalletClient({ account, chain: rabdi({ accessKey: this.config!.accessKey }),
      transport: http(arkivTransportUrl(this.rpcUrl, this.config!.accessKey), { timeout: 15_000, retryCount: 1 }) });
  }

  private rowToGrant(row: Record<string, unknown>): Grant {
    const identities = decodeGrantIdentities(row.identity_data);
    const identity = (field: string): string => {
      const index = bareStr(row[field] as { value: string });
      const full = identities[field];
      if (full !== undefined && identityIndex(full) !== index) throw new Error('ARKIV_IDENTITY_INVALID');
      return full ?? index;
    };
    if (typeof row.$key === 'string' && typeof row.$owner === 'string') this.entityOwners.set(row.$key, row.$owner);
    const id = bareStr(row.grant_id as { value: string });
    const grant: Grant = {
      id,
      feature: bareStr(row.feature as { value: string }),
      holder: identity('holder'),
      human_id: identity('human_id') || undefined,
      merchant: identity('merchant') || undefined,
      enabled: parseFlag(bareStr(row.enabled as { value: string })),
      remaining: bareDec(row.remaining as { value: string }),
      renewal_enabled: parseFlag(bareStr(row.renewal_enabled as { value: string })),
      paid_through: bareStr(row.paid_through as { value: string }),
      payment_tx: bareStr(row.payment_tx as { value: string }) || undefined,
      settlement_network: normalizeSettlement(bareStr(row.settlement_network as { value: string })),
      world_proof_id: identity('world_proof_id') || undefined,
      mandate_id: bareStr(row.mandate_id as { value: string }) || undefined,
      worker_id: bareStr(row.worker_id as { value: string }) || undefined,
      schema_version: 1,
      created_at: bareStr(row.created_at as { value: string }) || nowIso(),
      updated_at: bareStr(row.updated_at as { value: string }) || nowIso(),
      arkiv_entity_key: typeof row.$key === 'string' ? row.$key : undefined,
    };
    if (grant.arkiv_entity_key) {
      this.entityKeys.set(grant.id, grant.arkiv_entity_key as Hex);
    }
    this.cache.set(grant.id, grant);
    return grant;
  }

  private async resolveEntityKey(id: string): Promise<Hex> {
    const cached = this.entityKeys.get(id);
    if (cached) return cached;
    this.ensureClients();
    const result = await this.public!
      .select({ $key: true, grant_id: true })
      .from(BagsevenGrants)
      .where(eq('grant_id', id))
      .fetch();
    const first = result.entities[0] as { $key?: Hex } | undefined;
    if (!first?.$key) throw new Error('GRANT_NOT_FOUND');
    this.entityKeys.set(id, first.$key);
    return first.$key;
  }

  async mint(raw: MintGrantInput): Promise<Grant> {
    const input = MintGrantInputSchema.parse(raw);
    if (input.world_denied) {
      throw new Error(
        'WORLD_DENIED: World Agent Pass failed, expired, or was cancelled — no grant written',
      );
    }
    validateMoney(input.remaining);

    this.ensureClients();
    const id = randomUUID();
    const created = nowIso();
    const paidThrough = new Date(Date.now() + input.ttl_seconds * 1000).toISOString();
    const settlement = input.settlement_network;

    const wallet = await this.walletFor(input.merchant);
    const { entityKey } = await wallet.createEntity(
      BagsevenGrants,
      {
        grant_id: id,
        feature: input.feature,
        ...encodeGrantIdentities(input),
        enabled: flag(true),
        remaining: dec(input.remaining),
        renewal_enabled: flag(input.renewal_enabled),
        paid_through: paidThrough,
        payment_tx: input.payment_tx ?? '',
        settlement_network: settlement,
        mandate_id: input.mandate_id ?? '',
        worker_id: input.worker_id ?? '',
        created_at: created,
        updated_at: created,
      },
      { expiration: ExpirationTime.fromSeconds(input.ttl_seconds) },
    );

    const grant: Grant = {
      id,
      feature: input.feature,
      holder: input.holder,
      human_id: input.human_id,
      merchant: input.merchant,
      enabled: true,
      remaining: input.remaining,
      renewal_enabled: input.renewal_enabled,
      paid_through: paidThrough,
      payment_tx: input.payment_tx,
      settlement_network: settlement,
      world_proof_id: input.world_proof_id,
      mandate_id: input.mandate_id,
      worker_id: input.worker_id,
      schema_version: 1,
      created_at: created,
      updated_at: created,
      arkiv_entity_key: entityKey,
    };
    this.entityKeys.set(id, entityKey);
    if (wallet.account) this.entityOwners.set(entityKey, wallet.account.address);
    this.cache.set(id, grant);
    return grant;
  }

  async get(id: string): Promise<Grant | null> {
    const cached = this.cache.get(id);
    if (cached && !isExpired(cached)) return cached;
    this.ensureClients();
    try {
      const key = await this.resolveEntityKey(id);
      const row = await this.public!.getEntity(key, BagsevenGrants);
      return this.rowToGrant(row as unknown as Record<string, unknown>);
    } catch {
      return this.cache.get(id) ?? null;
    }
  }

  async findLive(query: {
    holder?: string;
    feature?: string;
    worker_id?: string;
  }): Promise<Grant[]> {

    this.ensureClients();
    const at = Date.now();
    const matches = (g: Grant): boolean => {
      if (query.feature && g.feature !== query.feature) return false;
      if (query.holder && g.holder !== query.holder) return false;
      if (query.worker_id && g.worker_id !== query.worker_id) return false;
      return !isExpired(g, at) && g.enabled && gte(g.remaining, '0') && moneyGt(g.remaining, '0');
    };

    // Always include process cache (covers query lag right after mint).
    const byId = new Map<string, Grant>();
    for (const g of this.cache.values()) {
      if (matches(g)) byId.set(g.id, g);
    }

    try {
      // Indexed remaining/enabled on-chain; feature/holder/worker filtered client-side
      // to keep the SDK FilterCheck happy across optional query dims.
      const result = await this.public!
        .select()
        .from(BagsevenGrants)
        .where(and(gt('remaining', dec('0')), eq('enabled', 'true')))
        .fetch();

      for (const row of result.entities as unknown as Record<string, unknown>[]) {
        const g = this.rowToGrant(row);
        if (matches(g)) byId.set(g.id, g);
      }
    } catch {
      // Query surface can lag or fail; cached mints still power the operator UI.
    }

    return [...byId.values()];
  }

  async consume(id: string, amount: string, idempotencyKey: string): Promise<Grant> {
    validateMoney(amount);
    if (!moneyGt(amount, '0')) throw new Error('INVALID_AMOUNT: consume amount must be positive');
    const key = `${id}:${idempotencyKey}`;
    const prior = this.consumeSnapshots.get(key);
    if (prior) return prior;
    if (this.consumedKeys.has(key)) throw new Error('IDEMPOTENCY_CONFLICT');

    const grant = (await this.get(id)) ?? (() => {
      throw new Error('GRANT_NOT_FOUND');
    })();
    assertLive(grant);
    if (!gte(grant.remaining, amount)) throw new Error('GRANT_EMPTY: remaining credits insufficient');

    this.ensureClients();
    const entityKey = await this.resolveEntityKey(id);
    const nextRemaining = sub(grant.remaining, amount);
    const updated = nowIso();
    const wallet = await this.walletFor(grant.merchant, entityKey);
    await wallet.patchEntity(BagsevenGrants, entityKey, {
      set: { remaining: dec(nextRemaining), updated_at: updated },
    });

    const next: Grant = { ...grant, remaining: nextRemaining, updated_at: updated };
    this.cache.set(id, next);
    this.consumedKeys.add(key);
    this.consumeSnapshots.set(key, next);
    return next;
  }

  async cancelRenewal(id: string): Promise<Grant> {
    const grant = (await this.get(id)) ?? (() => {
      throw new Error('GRANT_NOT_FOUND');
    })();
    this.ensureClients();
    const entityKey = await this.resolveEntityKey(id);
    const updated = nowIso();
    const wallet = await this.walletFor(grant.merchant, entityKey);
    await wallet.patchEntity(BagsevenGrants, entityKey, {
      set: { renewal_enabled: flag(false), updated_at: updated },
    });
    const next: Grant = { ...grant, renewal_enabled: false, updated_at: updated };
    this.cache.set(id, next);
    return next;
  }

  async hold(id: string, amount: string, holdId: string): Promise<Grant> {
    validateMoney(amount);
    if (this.holds.has(holdId)) throw new Error('HOLD_EXISTS');
    const grant = (await this.get(id)) ?? (() => {
      throw new Error('GRANT_NOT_FOUND');
    })();
    assertLive(grant);
    if (!gte(grant.remaining, amount)) throw new Error('GRANT_EMPTY');
    this.ensureClients();
    const entityKey = await this.resolveEntityKey(id);
    const nextRemaining = sub(grant.remaining, amount);
    const updated = nowIso();
    const wallet = await this.walletFor(grant.merchant, entityKey);
    await wallet.patchEntity(BagsevenGrants, entityKey, {
      set: { remaining: dec(nextRemaining), updated_at: updated },
    });
    const next: Grant = { ...grant, remaining: nextRemaining, updated_at: updated };
    this.cache.set(id, next);
    this.holds.set(holdId, { holdId, grantId: id, amount });
    return next;
  }

  async commit(holdId: string): Promise<Grant> {
    const hold = this.holds.get(holdId);
    if (!hold) throw new Error('HOLD_NOT_FOUND');
    this.holds.delete(holdId);
    const grant = await this.get(hold.grantId);
    if (!grant) throw new Error('GRANT_NOT_FOUND');
    return grant;
  }

  async release(holdId: string): Promise<Grant> {
    const hold = this.holds.get(holdId);
    if (!hold) throw new Error('HOLD_NOT_FOUND');
    this.holds.delete(holdId);
    const grant = (await this.get(hold.grantId)) ?? (() => {
      throw new Error('GRANT_NOT_FOUND');
    })();
    this.ensureClients();
    const entityKey = await this.resolveEntityKey(hold.grantId);
    const nextRemaining = add(grant.remaining, hold.amount);
    const updated = nowIso();
    const wallet = await this.walletFor(grant.merchant, entityKey);
    await wallet.patchEntity(BagsevenGrants, entityKey, {
      set: { remaining: dec(nextRemaining), updated_at: updated },
    });
    const next: Grant = { ...grant, remaining: nextRemaining, updated_at: updated };
    this.cache.set(hold.grantId, next);
    return next;
  }

  describe(): { mode: 'arkiv'; rpcUrl: string; live: boolean } {
    return {
      mode: 'arkiv',
      rpcUrl: this.rpcUrl,
      live: this.live,
    };
  }
}
