import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertKnownFeature } from '@bagseven/entitlements';
import { WHITECHAIN_CHAIN_ID } from '@bagseven/onchain';

export const PlanSchema = z.object({
  id: z.string().min(1),
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
  holder: z.string().min(1),
  status: z.enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED']),
  amount: z.string().min(1),
  chain_id: z.number().int().default(WHITECHAIN_CHAIN_ID),
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
  holder: z.string().min(1),
  success_url: z.string().url().optional(),
  expires_in: z.number().int().positive().max(86_400).default(3600),
});

function nowIso(): string {
  return new Date().toISOString();
}

/** Process-wide memory store (tests + local). Postgres schema exists for migrate. */
export class MemoryBillingStore {
  private plans = new Map<string, Plan>();
  private sessions = new Map<string, CheckoutSession>();

  createPlan(raw: z.input<typeof CreatePlanInput>): Plan {
    const input = CreatePlanInput.parse(raw);
    assertKnownFeature(input.feature);
    const plan: Plan = {
      id: `plan_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      feature: input.feature,
      name: input.name,
      amount: input.amount,
      interval: input.interval,
      credits: input.credits,
      ttl_seconds: input.ttl_seconds,
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
      status: 'PENDING',
      amount: plan.amount,
      chain_id: WHITECHAIN_CHAIN_ID,
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

  markPaid(id: string, input: { payment_tx: string; customer_wallet: string; grant_id: string }): CheckoutSession {
    const s = this.getCheckout(id);
    if (!s) throw new Error('CHECKOUT_NOT_FOUND');
    if (s.status === 'EXPIRED') throw new Error('CHECKOUT_EXPIRED');
    if (s.status === 'PAID') return s;
    if (s.status !== 'PENDING') throw new Error(`CHECKOUT_${s.status}`);
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

let singleton: MemoryBillingStore | undefined;

export function getBillingStore(): MemoryBillingStore {
  if (!singleton) singleton = new MemoryBillingStore();
  return singleton;
}

export function resetBillingStoreForTests(): void {
  singleton = undefined;
}
