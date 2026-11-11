import { formatUnits } from 'viem';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertKnownFeature } from '@bagseven/entitlements';
import { AVALANCHE_FUJI_CHAIN_ID, avalancheConfig } from '@bagseven/onchain';
import { usdtUnits } from './avalanche-payment.js';
import { billingPlans, checkoutSessions, type Database } from '@bagseven/db';
import { desc, eq } from 'drizzle-orm';

export const PlanSchema = z.object({
  id: z.string().min(1),
  provider_id: z.string().min(1).default('legacy'),
  feature: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().min(1),
  interval: z.enum(['once', 'month']).default('once'),
  credits: z.string().default('10'),
  ttl_seconds: z.number().int().positive().default(3600),
  merchant_wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  active: z.boolean().default(true),
  created_at: z.string(),
});

export type Plan = z.infer<typeof PlanSchema>;

export const CheckoutSessionSchema = z.object({
  id: z.string().min(1),
  plan_id: z.string().min(1),
  worker_id: z.string().uuid().optional(),
  holder: z.string().min(1),
  status: z.enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED']),
  amount: z.string().min(1),
  platform_fee_bps: z.number().int().default(0),
  platform_fee_amount: z.string().default('0'),
  chain_id: z.number().int().default(AVALANCHE_FUJI_CHAIN_ID),
  customer_wallet: z.string().optional(),
  payment_tx: z.string().optional(),
  grant_id: z.string().optional(),
  success_url: z.string().optional(),
  expires_at: z.string(),
  created_at: z.string(),
  plan: PlanSchema.optional(),
});

export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

export const CreatePlanInput = z.object({
  provider_id: z.string().min(1).default('legacy'),
  feature: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().min(1),
  interval: z.enum(['once', 'month']).default('once'),
  credits: z.string().default('10'),
  ttl_seconds: z.number().int().positive().default(3600),
  merchant_wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  active: z.boolean().default(true),
});

export const CreateCheckoutInput = z.object({
  plan_id: z.string().min(1),
  worker_id: z.string().uuid().optional(),
  holder: z.string().min(1),
  success_url: z.string().url().optional(),
  expires_in: z.number().int().positive().max(86_400).default(3600),
});

/** 0.1% owed by the provider; preserve fractional micro-USDT until invoicing. */
export function platformFee(amount: string): string {
  return formatUnits(usdtUnits(amount), 9);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Process-wide memory store (tests + local). Postgres schema exists for migrate. */
export class MemoryBillingStore {
  private plans = new Map<string, Plan>();
  private sessions = new Map<string, CheckoutSession>();
  private payments = new Map<string, string>();

  claimPayment(hash: string, checkoutId: string): void {
    const key = hash.toLowerCase();
    const prior = this.payments.get(key);
    if (prior && prior !== checkoutId) throw new Error('PAYMENT_REUSED: this transaction belongs to another checkout');
    this.payments.set(key, checkoutId);
  }

  createPlan(raw: z.input<typeof CreatePlanInput>): Plan {
    const input = CreatePlanInput.parse(raw);
    assertKnownFeature(input.feature);
    usdtUnits(input.amount);
    if (!/^\d+(\.\d+)?$/.test(input.credits) || Number(input.credits) <= 0) throw new Error('Plan credits must be positive');
    const plan: Plan = {
      id: `plan_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      provider_id: input.provider_id,
      feature: input.feature,
      name: input.name,
      amount: input.amount,
      interval: input.interval,
      credits: input.credits,
      ttl_seconds: input.interval === 'month' ? 30 * 86400 : input.ttl_seconds,
      merchant_wallet: input.merchant_wallet.toLowerCase() as `0x${string}`,
      active: input.active,
      created_at: nowIso(),
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  listPlans(activeOnly = false): Plan[] {
    return [...this.plans.values()].filter((p) => (activeOnly ? p.active : true));
  }

  getPlan(id: string): Plan | null {
    return this.plans.get(id) ?? null;
  }

  createCheckout(raw: z.input<typeof CreateCheckoutInput>): CheckoutSession {
    const input = CreateCheckoutInput.parse(raw);
    const plan = this.plans.get(input.plan_id);
    if (!plan || !plan.active) throw new Error('PLAN_NOT_FOUND');
    const id = `cs_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const session: CheckoutSession = {
      id,
      plan_id: plan.id,
      holder: input.holder,
      worker_id: input.worker_id,
      status: 'PENDING',
      amount: plan.amount,
      chain_id: avalancheConfig().chainId,
      platform_fee_bps: 10,
      platform_fee_amount: platformFee(plan.amount),
      success_url: input.success_url,
      expires_at: new Date(Date.now() + input.expires_in * 1000).toISOString(),
      created_at: nowIso(),
      plan,
    };
    this.sessions.set(id, session);
    return session;
  }

  getCheckout(id: string): CheckoutSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.status === 'PENDING' && new Date(s.expires_at).getTime() <= Date.now()) {
      const expired = { ...s, status: 'EXPIRED' as const };
      this.sessions.set(id, expired);
      return { ...expired, plan: this.plans.get(s.plan_id) };
    }
    return { ...s, plan: this.plans.get(s.plan_id) };
  }

  listCheckouts(opts?: { holder?: string; plan_id?: string }): CheckoutSession[] {
    return [...this.sessions.values()]
      .filter((s) => (opts?.holder ? s.holder === opts.holder : true))
      .filter((s) => (opts?.plan_id ? s.plan_id === opts.plan_id : true))
      .map((s) => ({ ...s, plan: this.plans.get(s.plan_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  markPaid(id: string, input: { payment_tx: string; customer_wallet: string; grant_id: string; allow_expired?: boolean }): CheckoutSession {
    const s = this.getCheckout(id);
    if (!s) throw new Error('CHECKOUT_NOT_FOUND');
    if (s.status === 'EXPIRED' && !input.allow_expired) throw new Error('CHECKOUT_EXPIRED');
    if (s.status === 'PAID') return s;
    if (s.status !== 'PENDING' && !(s.status === 'EXPIRED' && input.allow_expired)) throw new Error(`CHECKOUT_${s.status}`);
    const next: CheckoutSession = {
      ...s,
      status: 'PAID',
      payment_tx: input.payment_tx,
      customer_wallet: input.customer_wallet.toLowerCase(),
      grant_id: input.grant_id,
    };
    this.sessions.set(id, next);
    return { ...next, plan: this.plans.get(s.plan_id) };
  }

  markFailed(id: string): CheckoutSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error('CHECKOUT_NOT_FOUND');
    const next = { ...s, status: 'FAILED' as const };
    this.sessions.set(id, next);
    return next;
  }
}

type BillingStore = { [K in keyof MemoryBillingStore]: MemoryBillingStore[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : never };

/** Live plans and checkout sessions survive daemon restarts. */
export class PostgresBillingStore implements BillingStore {
  constructor(private readonly db: Database) {}
  async createPlan(raw: z.input<typeof CreatePlanInput>): Promise<Plan> {
    const plan = new MemoryBillingStore().createPlan(raw);
    await this.db.insert(billingPlans).values({
      id: plan.id, providerId: plan.provider_id, feature: plan.feature, name: plan.name, amount: plan.amount, interval: plan.interval,
      credits: plan.credits, ttlSeconds: plan.ttl_seconds, merchantWallet: plan.merchant_wallet,
      active: String(plan.active), createdAt: new Date(plan.created_at),
    });
    return plan;
  }
  async getPlan(id: string): Promise<Plan | null> {
    const [p] = await this.db.select().from(billingPlans).where(eq(billingPlans.id, id));
    return p ? PlanSchema.parse({ ...p, provider_id: p.providerId, active: p.active === 'true', ttl_seconds: p.ttlSeconds, merchant_wallet: p.merchantWallet, created_at: p.createdAt.toISOString() }) : null;
  }
  async listPlans(activeOnly = false): Promise<Plan[]> {
    const rows = await this.db.select().from(billingPlans).orderBy(desc(billingPlans.createdAt));
    return rows.filter((p) => !activeOnly || p.active === 'true').map((p) => PlanSchema.parse({ ...p, provider_id: p.providerId, active: p.active === 'true', ttl_seconds: p.ttlSeconds, merchant_wallet: p.merchantWallet, created_at: p.createdAt.toISOString() }));
  }
  async createCheckout(raw: z.input<typeof CreateCheckoutInput>): Promise<CheckoutSession> {
    const input = CreateCheckoutInput.parse(raw);
    const plan = await this.getPlan(input.plan_id);
    if (!plan?.active) throw new Error('PLAN_NOT_FOUND');
    const session: CheckoutSession = { id: `cs_${randomUUID().replace(/-/g, '')}`, plan_id: plan.id, holder: input.holder, worker_id: input.worker_id, status: 'PENDING', amount: plan.amount, chain_id: avalancheConfig().chainId, platform_fee_bps: 10, platform_fee_amount: platformFee(plan.amount), success_url: input.success_url, expires_at: new Date(Date.now() + input.expires_in * 1000).toISOString(), created_at: nowIso(), plan };
    await this.db.insert(checkoutSessions).values({ id: session.id, planId: plan.id, holder: session.holder, workerId: session.worker_id, status: session.status, amount: session.amount, chainId: session.chain_id, platformFeeBps: session.platform_fee_bps, platformFeeAmount: session.platform_fee_amount, successUrl: session.success_url, expiresAt: new Date(session.expires_at) });
    return session;
  }
  async getCheckout(id: string): Promise<CheckoutSession | null> {
    const [s] = await this.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id));
    if (!s) return null;
    const status = s.status === 'PENDING' && s.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : s.status;
    return CheckoutSessionSchema.parse({ ...s, status, plan_id: s.planId, worker_id: s.workerId || undefined, chain_id: s.chainId, platform_fee_bps: s.platformFeeBps, platform_fee_amount: s.platformFeeAmount, customer_wallet: s.customerWallet || undefined, payment_tx: s.paymentTx || undefined, grant_id: s.grantId || undefined, success_url: s.successUrl || undefined, expires_at: s.expiresAt.toISOString(), created_at: s.createdAt.toISOString(), plan: await this.getPlan(s.planId) });
  }
  async listCheckouts(opts?: { holder?: string; plan_id?: string }): Promise<CheckoutSession[]> {
    const rows = await this.db.select().from(checkoutSessions).orderBy(desc(checkoutSessions.createdAt));
    const filtered = rows.filter((s) => (!opts?.holder || s.holder === opts.holder) && (!opts?.plan_id || s.planId === opts.plan_id));
    return (await Promise.all(filtered.map((s) => this.getCheckout(s.id)))).filter((s): s is CheckoutSession => s !== null);
  }
  async claimPayment(hash: string, id: string): Promise<void> {
    const rows = await this.db.select().from(checkoutSessions).where(eq(checkoutSessions.paymentTx, hash.toLowerCase()));
    if (rows.some(row => row.id !== id)) throw new Error('PAYMENT_REUSED');
    if (rows.length) return; // Receipt remains bound to the same checkout on a safe retry.
    await this.db.update(checkoutSessions).set({ paymentTx: hash.toLowerCase() }).where(eq(checkoutSessions.id, id));
  }
  async markPaid(id: string, input: { payment_tx: string; customer_wallet: string; grant_id: string; allow_expired?: boolean }): Promise<CheckoutSession> {
    const session = await this.getCheckout(id);
    if (!session) throw new Error('CHECKOUT_NOT_FOUND');
    if (session.status === 'PAID') return session;
    if (session.status !== 'PENDING' && !(session.status === 'EXPIRED' && input.allow_expired)) throw new Error(`CHECKOUT_${session.status}`);
    await this.db.update(checkoutSessions).set({ status: 'PAID', paymentTx: input.payment_tx.toLowerCase(), customerWallet: input.customer_wallet.toLowerCase(), grantId: input.grant_id }).where(eq(checkoutSessions.id, id));
    return (await this.getCheckout(id))!;
  }
  async markFailed(id: string): Promise<CheckoutSession> {
    await this.db.update(checkoutSessions).set({ status: 'FAILED' }).where(eq(checkoutSessions.id, id));
    const session = await this.getCheckout(id);
    if (!session) throw new Error('CHECKOUT_NOT_FOUND');
    return session;
  }
}

let singleton: BillingStore | undefined;

export function getBillingStore(db?: Database): BillingStore {
  if (!singleton) singleton = db ? new PostgresBillingStore(db) : new MemoryBillingStore();
  return singleton;
}

export function resetBillingStoreForTests(): void {
  singleton = undefined;
}
