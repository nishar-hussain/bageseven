import type { Subscriptions } from './subscriptions.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@bagseven/server';
import { EntitlementPreflightError, getGrantStore } from '@bagseven/entitlements';
import type { Redis } from 'ioredis';
import type { Database } from '@bagseven/db';
import { ProviderGasManager, providerGasEnabled, verifyProviderScope, avalancheConfig } from '@bagseven/onchain';
import { assertProviderReady } from './provider-gas.js';
import { verifyPaymentAuthorization, verifyAvalanchePayment } from './avalanche-payment.js';
import { avalancheDemoAllowed } from './avalanche-settle.js';
import {
  authenticateRequest,
  type ApiPrincipal,
} from './api-keys.js';
import {
  CreateCheckoutInput,
  CreatePlanInput,
  getBillingStore,
} from './billing-store.js';

const confirmBody = z.object({
  payment_tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  customer_wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  payment_signature: z.string().optional(),
});

function principalFrom(auth: string | string[] | undefined): ApiPrincipal {
  return authenticateRequest(auth, process.env);
}

/** Provider scope is accepted only from the authenticated console BFF. */
export function providerScope(req: { headers: { authorization?: string; [key: string]: unknown } }): string | undefined {
  const provider = req.headers['x-bagseven-provider'];
  if (provider === undefined) return undefined;
  if (typeof provider !== 'string' || !provider.trim() || req.headers.authorization !== `Bearer ${process.env.DAEMON_AUTH_TOKEN}`) {
    throw new ApiError(403, 'FORBIDDEN', 'Provider scope requires console authentication');
  }
  if (providerGasEnabled(process.env) && !verifyProviderScope(req.headers['x-bagseven-provider-scope'], provider, process.env)) throw new ApiError(403, 'PROVIDER_SCOPE_REQUIRED', 'Provider-funded plans require a signed provider session scope');
  return provider;
}

/** Console provider sees its own plans plus unscoped SK/seed `legacy` plans. */
function planInProviderScope(plan: { provider_id?: string } | null | undefined, provider?: string): boolean {
  if (!plan) return false;
  if (!provider) return true;
  return plan.provider_id === provider || plan.provider_id === 'legacy';
}

export function registerBillingRoutes(
  app: FastifyInstance,
  deps: { redis?: Redis; db?: Database; validateWorker?: (worker: string) => Promise<void>; subscriptions?: Subscriptions } = {},
): void {
  const store = getBillingStore(deps.db);
  const grants = getGrantStore(process.env);
  const gas = deps.db ? new ProviderGasManager(deps.db, process.env) : undefined;
  async function ready(provider: string) {
    if (!providerGasEnabled(process.env) || !deps.db) return;
    if (provider === 'legacy') throw new ApiError(409, 'PROVIDER_GAS_REQUIRED', 'Legacy plans need a provider binding; create a provider plan after configuring its gas account');
    await assertProviderReady(gas!, provider, process.env);
  }
  const confirmations = new Map<string, Promise<unknown>>();

  app.post('/v1/plans', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    if (principal.kind !== 'sk') throw new ApiError(403, 'FORBIDDEN', 'secret key required to create plans');
    try {
      const plan = await store.createPlan({ ...CreatePlanInput.parse(req.body ?? {}), provider_id: providerScope(req) ?? 'legacy' });
      return { plan };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(400, 'VALIDATION', e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/v1/plans', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    if (principal.kind === 'embed') throw new ApiError(403, 'FORBIDDEN', 'embed tokens cannot list merchant plans');
    const q = req.query as { active?: string };
    const provider = providerScope(req);
    // Console scopes by provider; still surface unscoped 'legacy' plans created via secret key / seeds.
    return {
      plans: (await store.listPlans(q.active === 'true')).filter(
        (p) => !provider || p.provider_id === provider || p.provider_id === 'legacy',
      ),
    };
  });

  app.get('/v1/plans/:id', async (req) => {
    principalFrom(req.headers.authorization);
    const { id } = req.params as { id: string };
    const plan = await store.getPlan(id);
    if (!planInProviderScope(plan, providerScope(req))) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan not found');
    return { plan };
  });

  app.post('/v1/checkout-sessions', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    if (principal.kind === 'pk') throw new ApiError(403, 'FORBIDDEN', 'publishable keys cannot create checkout sessions');
    try {
      const body = CreateCheckoutInput.parse(req.body ?? {});
      if (principal.kind === 'embed' && body.holder !== principal.holder) {
        throw new ApiError(403, 'HOLDER_MISMATCH', 'embed token is scoped to a different holder');
      }
      const plan = await store.getPlan(body.plan_id);
      const provider = providerScope(req);
      if (!planInProviderScope(plan, provider)) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan not found');
      await ready(plan!.provider_id);
      // Human checkout is independent of the deployment's optional MCP agent.
      const worker = body.worker_id || undefined;
      if (worker && deps.validateWorker) await deps.validateWorker(worker);
      if (plan!.interval === 'month') {
        if (!deps.subscriptions) throw new ApiError(503, 'SUBSCRIPTIONS_UNAVAILABLE', 'Recurring billing requires the durable subscription service');
        await deps.subscriptions.prepare(plan!);
      }
      const session = await store.createCheckout({ ...body, worker_id: worker });
      return { session, checkout_session: session };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError(msg === 'PLAN_NOT_FOUND' ? 404 : 400, msg.split(':')[0] ?? 'VALIDATION', msg);
    }
  });

  app.get('/v1/checkout-sessions', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    if (principal.kind !== 'sk') throw new ApiError(403, 'FORBIDDEN', 'secret key required');
    const q = req.query as { holder?: string; plan_id?: string };
    const provider = providerScope(req);
    return {
      sessions: (await store.listCheckouts({ holder: q.holder, plan_id: q.plan_id })).filter((s) =>
        planInProviderScope(s.plan, provider),
      ),
    };
  });

  app.get('/v1/checkout-sessions/:id', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    const { id } = req.params as { id: string };
    const session = await store.getCheckout(id);
    if (!session) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    const provider = providerScope(req);
    if (!planInProviderScope(session.plan, provider)) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    if (principal.kind === 'embed' && session.holder !== principal.holder) {
      throw new ApiError(403, 'HOLDER_MISMATCH', 'embed token is scoped to a different holder');
    }
    return { session };
  });

  /** Public resolve — no daemon Bearer; still requires session id knowledge. */
  app.get('/v1/public/checkout/:id', async (req) => {
    const { id } = req.params as { id: string };
    const session = await store.getCheckout(id);
    if (!session) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    if (session.status === 'PENDING') {
      const plan = session.plan ?? await store.getPlan(session.plan_id);
      if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan missing');
      await ready(plan.provider_id);
    }
    return {
      session: {
        id: session.id,
        status: session.status,
        amount: session.amount,
        chain_id: session.chain_id,
        worker_id: session.worker_id,
        subscription_plan: session.plan?.interval === 'month' && deps.subscriptions ? await deps.subscriptions.planView(session.plan_id, session.id, session.expires_at) : null,
        payment: { chain_id: session.chain_id, usdt: avalancheConfig().usdt, rpc_url: avalancheConfig().rpcUrl, explorer: avalancheConfig().explorer },
        holder: session.holder,
        expires_at: session.expires_at,
        customer_wallet: session.customer_wallet,
        payment_tx: session.payment_tx,
        grant_id: session.grant_id,
        success_url: session.success_url,
        plan: session.plan
          ? {
              id: session.plan.id,
              name: session.plan.name,
              feature: session.plan.feature,
              amount: session.plan.amount,
              credits: session.plan.credits,
              ttl_seconds: session.plan.ttl_seconds,
              interval: session.plan.interval,
              merchant_wallet: session.plan.merchant_wallet,
            }
          : null,
      },
    };
  });

  app.post('/v1/public/checkout/:id/confirm', async (req) => {
    const { id } = req.params as { id: string };
    const body = confirmBody.parse(req.body ?? {});
    const session = await store.getCheckout(id);
    if (!session) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    if (session.status === 'PAID') return { session, already_paid: true };
    if (session.status !== 'PENDING' && !(session.status === 'EXPIRED' && session.plan?.interval === 'month')) throw new ApiError(409, `CHECKOUT_${session.status}`, `session is ${session.status}`);
    const plan = session.plan ?? await store.getPlan(session.plan_id);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan missing');
    await ready(plan.provider_id);
    if (session.chain_id !== avalancheConfig().chainId) throw new ApiError(409, 'CHECKOUT_NETWORK_CHANGED', 'Create a new checkout for the configured network');

    const pending = confirmations.get(id);
    if (pending) return pending;
    const confirm = async () => {
      const demo = avalancheDemoAllowed();
      if (!demo || plan.interval === 'month') {
        try {
          await verifyPaymentAuthorization({ wallet: body.customer_wallet, signature: body.payment_signature, context: `checkout:${session.id}`, hash: body.payment_tx });
          await verifyAvalanchePayment({
            payment_tx: body.payment_tx, merchant_wallet: plan.merchant_wallet,
            customer_wallet: body.customer_wallet, amount: session.amount,
          });
        } catch (error) {
          // Keep the checkout payable: an RPC outage or pending receipt is retryable.
          throw new ApiError(402, 'PAYMENT_UNVERIFIED', error instanceof Error ? error.message : String(error));
        }
      }
      // Stable fulfillment identity survives a crash between registry issue and markPaid.
      const digest = createHash('sha256').update(`checkout:${session.chain_id}:${session.id}`).digest('hex');
      const fulfillmentId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const recovered = plan.interval === 'once' ? await grants.get(fulfillmentId) ?? await grants.recoverMint?.(fulfillmentId, {
        holder: session.holder, feature: plan.feature, merchant: plan.provider_id, payment_tx: body.payment_tx,
      }) ?? null : null;
      if (recovered && (recovered.payment_tx?.toLowerCase() !== body.payment_tx.toLowerCase() ||
        recovered.holder !== session.holder || recovered.feature !== plan.feature || recovered.merchant !== plan.provider_id)) {
        throw new ApiError(409, 'CHECKOUT_FULFILLMENT_CONFLICT', 'Stored access does not match this checkout payment');
      }
      const paymentKey = `avalanche:payment:${session.chain_id}:${body.payment_tx.toLowerCase()}`;
      if (deps.redis) {
        const fresh = await deps.redis.set(paymentKey, id, 'NX');
        if (!fresh && (await deps.redis.get(paymentKey) !== id || (plan.interval !== 'month' && !recovered && await deps.redis.getdel(`${paymentKey}:preflight-retry`) !== id))) {
          throw new ApiError(409, 'PAYMENT_REUSED', 'This payment is already redeemed or awaiting reconciliation; check its existing entitlement');
        }
      } else if (process.env.NODE_ENV === 'production') {
        throw new ApiError(503, 'PAYMENT_LEDGER_UNAVAILABLE', 'Payment replay protection is not configured');
      }
      try { await store.claimPayment(body.payment_tx, id); } catch {
        throw new ApiError(409, 'PAYMENT_REUSED', 'This payment already belongs to another checkout');
      }

      const live = await grants.findLive({ holder: session.holder, feature: plan.feature });
      const prior = live[0];
      const grant = plan.interval === 'month'
        ? await (deps.subscriptions ?? (() => { throw new ApiError(503, 'SUBSCRIPTIONS_UNAVAILABLE', 'Recurring billing is not configured'); })()).completeCheckout({ ...session, plan }, body.customer_wallet, body.payment_tx, prior)
        : recovered ?? await grants.mint({
        id: fulfillmentId,
        merchant: plan.provider_id,
        feature: plan.feature,
        holder: session.holder,
        remaining: plan.credits,
        ttl_seconds: plan.ttl_seconds,
        payment_tx: body.payment_tx,
        settlement_network: 'avalanche',
        human_id: prior?.human_id,
        worker_id: session.worker_id || prior?.worker_id,
        renewal_enabled: false,
      }).catch(async error => {
        // SDK value validation happens before signing/broadcast. Unknown write
        // failures retain the receipt hold and require reconciliation.
        if (error instanceof EntitlementPreflightError && deps.redis) await deps.redis.set(`${paymentKey}:preflight-retry`, id);
        throw error;
      });

      const paid = await store.markPaid(id, {
        payment_tx: body.payment_tx,
        customer_wallet: body.customer_wallet,
        grant_id: grant.id,
        allow_expired: plan.interval === 'month',
      });

      return {
        session: paid,
        grant,
        verification: demo ? 'demo' : 'verified',
      };
    };
    const result = confirm();
    confirmations.set(id, result);
    try { return await result; } finally { confirmations.delete(id); }
  });
}
