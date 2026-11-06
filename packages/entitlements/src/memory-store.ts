import { randomUUID } from 'node:crypto';
import { add, gte, gt, sub, validateMoney } from '@bagseven/money';
import type { Grant, GrantStore, GrantStoreDescribe, MintGrantInput } from './types.js';
import { MintGrantInputSchema } from './types.js';

interface HoldRecord {
  holdId: string;
  grantId: string;
  amount: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(grant: Grant, at = Date.now()): boolean {
  return new Date(grant.paid_through).getTime() <= at;
}

function assertLive(grant: Grant): void {
  if (!grant.enabled) throw new Error('GRANT_DISABLED: grant is disabled');
  if (isExpired(grant)) throw new Error('GRANT_EXPIRED: paid_through has passed; access left the query surface');
}

/**
 * Local stand-in for Arkiv. Same semantics: after paid_through, findLive
 * no longer returns the grant (evaporating access).
 */
export class MemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, Grant>();
  private readonly holds = new Map<string, HoldRecord>();
  private readonly consumedKeys = new Set<string>();
  private readonly consumeSnapshots = new Map<string, Grant>();

  async mint(raw: MintGrantInput): Promise<Grant> {
    const input = MintGrantInputSchema.parse(raw);
    if (input.world_denied) {
      throw new Error('WORLD_DENIED: World Agent Pass failed, expired, or was cancelled — no grant written');
    }
    validateMoney(input.remaining);
    const created = nowIso();
    const paidThrough = new Date(Date.now() + input.ttl_seconds * 1000).toISOString();
    const grant: Grant = {
      id: randomUUID(),
      feature: input.feature,
      holder: input.holder,
      human_id: input.human_id,
      merchant: input.merchant,
      enabled: true,
      remaining: input.remaining,
      renewal_enabled: input.renewal_enabled,
      paid_through: paidThrough,
      payment_tx: input.payment_tx,
      settlement_network: input.settlement_network,
      world_proof_id: input.world_proof_id,
      mandate_id: input.mandate_id,
      worker_id: input.worker_id,
      schema_version: 1,
      created_at: created,
      updated_at: created,
    };
    this.grants.set(grant.id, grant);
    return grant;
  }

  async get(id: string): Promise<Grant | null> {
    return this.grants.get(id) ?? null;
  }

  async findLive(query: { holder?: string; feature?: string; worker_id?: string }): Promise<Grant[]> {
    const at = Date.now();
    return [...this.grants.values()].filter((grant) => {
      if (!grant.enabled || isExpired(grant, at)) return false;
      if (query.holder && grant.holder !== query.holder) return false;
      if (query.feature && grant.feature !== query.feature) return false;
      if (query.worker_id && grant.worker_id !== query.worker_id) return false;
      return true;
    });
  }

  async consume(id: string, amount: string, idempotencyKey: string): Promise<Grant> {
    validateMoney(amount);
    if (!gt(amount, '0')) throw new Error('INVALID_AMOUNT: consume amount must be positive');
    const key = `${id}:${idempotencyKey}`;
    const prior = this.consumeSnapshots.get(key);
    if (prior) return prior;
    if (this.consumedKeys.has(key)) throw new Error('IDEMPOTENCY_CONFLICT');
    const grant = this.grants.get(id);
    if (!grant) throw new Error('GRANT_NOT_FOUND');
    assertLive(grant);
    if (!gte(grant.remaining, amount)) throw new Error('GRANT_EMPTY: remaining credits insufficient');
    const next: Grant = {
      ...grant,
      remaining: sub(grant.remaining, amount),
      updated_at: nowIso(),
    };
    this.grants.set(id, next);
    this.consumedKeys.add(key);
    this.consumeSnapshots.set(key, next);
    return next;
  }

  async cancelRenewal(id: string): Promise<Grant> {
    const grant = this.grants.get(id);
    if (!grant) throw new Error('GRANT_NOT_FOUND');
    const next: Grant = { ...grant, renewal_enabled: false, updated_at: nowIso() };
    this.grants.set(id, next);
    return next;
  }

  async hold(id: string, amount: string, holdId: string): Promise<Grant> {
    validateMoney(amount);
    if (this.holds.has(holdId)) throw new Error('HOLD_EXISTS');
    const grant = this.grants.get(id);
    if (!grant) throw new Error('GRANT_NOT_FOUND');
    assertLive(grant);
    if (!gte(grant.remaining, amount)) throw new Error('GRANT_EMPTY');
    const next: Grant = { ...grant, remaining: sub(grant.remaining, amount), updated_at: nowIso() };
    this.grants.set(id, next);
    this.holds.set(holdId, { holdId, grantId: id, amount });
    return next;
  }

  async commit(holdId: string): Promise<Grant> {
    const hold = this.holds.get(holdId);
    if (!hold) throw new Error('HOLD_NOT_FOUND');
    this.holds.delete(holdId);
    const grant = this.grants.get(hold.grantId);
    if (!grant) throw new Error('GRANT_NOT_FOUND');
    return grant;
  }

  async release(holdId: string): Promise<Grant> {
    const hold = this.holds.get(holdId);
    if (!hold) throw new Error('HOLD_NOT_FOUND');
    this.holds.delete(holdId);
    const grant = this.grants.get(hold.grantId);
    if (!grant) throw new Error('GRANT_NOT_FOUND');
    const next: Grant = { ...grant, remaining: add(grant.remaining, hold.amount), updated_at: nowIso() };
    this.grants.set(hold.grantId, next);
    return next;
  }

  describe(): GrantStoreDescribe {
    return { mode: 'memory', live: false };
  }
}
