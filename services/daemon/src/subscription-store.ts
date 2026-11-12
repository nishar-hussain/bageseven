import { billingSubscriptions, subscriptionPeriods, subscriptionPlans, type Database } from '@bagseven/db';
import { and, asc, eq, gt, lte, ne, or, sql } from 'drizzle-orm';
import type { Subscription, SubscriptionPeriod, SubscriptionPlan } from './subscription-types.js';

export interface SubscriptionStore {
  plan(id: string): Promise<SubscriptionPlan | null>;
  savePlan(plan: SubscriptionPlan): Promise<void>;
  pendingPlans(after: string, limit: number): Promise<SubscriptionPlan[]>;
  get(id: string): Promise<Subscription | null>;
  save(subscription: Subscription): Promise<void>;
  list(holder?: string): Promise<Subscription[]>;
  due(now: number, limit: number): Promise<Subscription[]>;
  period(id: string): Promise<SubscriptionPeriod | null>;
  savePeriod(period: SubscriptionPeriod): Promise<void>;
  lock<T>(id: string, operation: () => Promise<T>): Promise<T | undefined>;
}

/** Process-local store is for deterministic tests only. Live registration requires Postgres. */
export class MemorySubscriptionStore implements SubscriptionStore {
  plans = new Map<string, SubscriptionPlan>();
  subscriptions = new Map<string, Subscription>();
  periods = new Map<string, SubscriptionPeriod>();
  locks = new Set<string>();
  async plan(id: string) { return structuredClone(this.plans.get(id) ?? null); }
  async savePlan(plan: SubscriptionPlan) { this.plans.set(plan.id, structuredClone(plan)); }
  async pendingPlans(after: string, limit: number) {
    return structuredClone([...this.plans.values()].filter(p => p.status === 'preparing' && p.id > after)
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit));
  }
  async get(id: string) { return structuredClone(this.subscriptions.get(id) ?? null); }
  async save(sub: Subscription) { this.subscriptions.set(sub.id, structuredClone(sub)); }
  async list(holder?: string) { return structuredClone([...this.subscriptions.values()].filter(s => !holder || s.holder === holder)); }
  async due(now: number, limit: number) {
    return structuredClone([...this.subscriptions.values()]
      .filter(s => s.status !== 'ENDED' && s.nextAttemptAt <= now &&
        (s.status !== 'CANCELLED' || s.lastError?.startsWith('RENEWAL_FLAG_SYNC_PENDING:')))
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.id.localeCompare(b.id)).slice(0, limit));
  }
  async period(id: string) { return structuredClone(this.periods.get(id) ?? null); }
  async savePeriod(period: SubscriptionPeriod) { this.periods.set(period.id, structuredClone(period)); }
  async lock<T>(id: string, operation: () => Promise<T>) {
    if (this.locks.has(id)) return undefined;
    this.locks.add(id);
    try { return await operation(); } finally { this.locks.delete(id); }
  }
}

export class PostgresSubscriptionStore implements SubscriptionStore {
  private locks = 0;
  constructor(private db: Database) {}
  async pendingPlans(after: string, limit: number) {
    const rows = await this.db.select().from(subscriptionPlans).where(and(gt(subscriptionPlans.id, after),
      sql`${subscriptionPlans.data}->>'status' = 'preparing'`)).orderBy(asc(subscriptionPlans.id)).limit(limit);
    return rows.map(row => row.data as SubscriptionPlan);
  }
  async plan(id: string) {
    const [row] = await this.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
    return row ? row.data as SubscriptionPlan : null;
  }
  async savePlan(plan: SubscriptionPlan) {
    await this.db.insert(subscriptionPlans).values({ id: plan.id, providerId: plan.providerId, data: plan })
      .onConflictDoUpdate({ target: subscriptionPlans.id, set: { data: plan } });
  }
  async get(id: string) {
    const [row] = await this.db.select().from(billingSubscriptions).where(eq(billingSubscriptions.id, id));
    return row ? row.data as Subscription : null;
  }
  async save(sub: Subscription) {
    const values = { id: sub.id, checkoutId: sub.checkoutId, holder: sub.holder, providerId: sub.providerId,
      status: sub.status, nextAttemptAt: new Date(sub.nextAttemptAt * 1000), data: sub };
    await this.db.insert(billingSubscriptions).values(values).onConflictDoUpdate({ target: billingSubscriptions.id,
      set: { status: values.status, nextAttemptAt: values.nextAttemptAt, data: sub } });
  }
  async list(holder?: string) {
    const rows = await this.db.select().from(billingSubscriptions).where(holder ? eq(billingSubscriptions.holder, holder) : undefined);
    return rows.map(row => row.data as Subscription);
  }
  async due(now: number, limit: number) {
    const rows = await this.db.select().from(billingSubscriptions).where(and(
      ne(billingSubscriptions.status, 'ENDED'),
      lte(billingSubscriptions.nextAttemptAt, new Date(now * 1000)),
      or(ne(billingSubscriptions.status, 'CANCELLED'),
        sql`${billingSubscriptions.data}->>'lastError' LIKE 'RENEWAL_FLAG_SYNC_PENDING:%'`),
    )).orderBy(asc(billingSubscriptions.nextAttemptAt), asc(billingSubscriptions.id)).limit(limit);
    return rows.map(row => row.data as Subscription);
  }
  async period(id: string) {
    const [row] = await this.db.select().from(subscriptionPeriods).where(eq(subscriptionPeriods.id, id));
    return row ? row.data as SubscriptionPeriod : null;
  }
  async savePeriod(period: SubscriptionPeriod) {
    await this.db.insert(subscriptionPeriods).values({ id: period.id, subscriptionId: period.subscriptionId, data: period })
      .onConflictDoUpdate({ target: subscriptionPeriods.id, set: { data: period } });
  }
  async lock<T>(id: string, operation: () => Promise<T>) {
    // At most two lock connections; the default ten-connection pool retains room
    // for independently committed journal writes BEFORE network broadcasts.
    if (this.locks >= 2) return undefined;
    this.locks++;
    try {
      return await this.db.transaction(async tx => {
        const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${'subscription:' + id}, 0)) as locked`);
        if (!result.rows[0]?.locked) return undefined;
        // Do not use tx for journal writes: they must survive a process crash.
        return operation();
      });
    } finally { this.locks--; }
  }
}
