import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@bagseven/server';
import { ArkivInvalidValueError, getGrantStore } from '@bagseven/entitlements';
import type { Redis } from 'ioredis';
import type { Database } from '@bagseven/db';
import { ProviderGasManager, providerGasEnabled, verifyProviderScope, whitechainConfig } from '@bagseven/onchain';
import { assertProviderReady } from './provider-gas.js';
import { verifyPaymentAuthorization, verifyWhitechainPayment } from './whitechain-payment.js';
import { whitechainDemoAllowed } from './whitechain-settle.js';
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
function providerScope(req: { headers: { authorization?: string; [key: string]: unknown } }): string | undefined {
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
  deps: { redis?: Redis; db?: Database; validateWorker?: (worker: string) => Promise<void> } = {},
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
        payment: { chain_id: session.chain_id, usdt: whitechainConfig().usdt, rpc_url: whitechainConfig().rpcUrl, explorer: whitechainConfig().explorer },
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
    if (session.status !== 'PENDING') throw new ApiError(409, `CHECKOUT_${session.status}`, `session is ${session.status}`);
    const plan = session.plan ?? await store.getPlan(session.plan_id);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan missing');
    await ready(plan.provider_id);
    if (session.chain_id !== whitechainConfig().chainId) throw new ApiError(409, 'CHECKOUT_NETWORK_CHANGED', 'Create a new checkout for the configured network');

    const pending = confirmations.get(id);
    if (pending) return pending;
    const confirm = async () => {
      const demo = whitechainDemoAllowed();
      if (!demo) {
        try {
          await verifyPaymentAuthorization({ wallet: body.customer_wallet, signature: body.payment_signature, context: `checkout:${session.id}`, hash: body.payment_tx });
          await verifyWhitechainPayment({
            payment_tx: body.payment_tx, merchant_wallet: plan.merchant_wallet,
            customer_wallet: body.customer_wallet, amount: session.amount,
          });
        } catch (error) {
          // Keep the checkout payable: an RPC outage or pending receipt is retryable.
          throw new ApiError(402, 'PAYMENT_UNVERIFIED', error instanceof Error ? error.message : String(error));
        }
      }
      const paymentKey = `whitechain:payment:${session.chain_id}:${body.payment_tx.toLowerCase()}`;
      if (deps.redis) {
        const fresh = await deps.redis.set(paymentKey, id, 'NX');
        if (!fresh && (await deps.redis.get(paymentKey) !== id || await deps.redis.getdel(`${paymentKey}:preflight-retry`) !== id)) {
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
      const grant = await grants.mint({
        merchant: plan.provider_id,
        feature: plan.feature,
        holder: session.holder,
        remaining: plan.credits,
        ttl_seconds: plan.ttl_seconds,
        payment_tx: body.payment_tx,
        settlement_network: 'whitechain',
        human_id: prior?.human_id,
        world_proof_id: prior?.world_proof_id ?? `world:checkout:${session.id}`,
        worker_id: session.worker_id || prior?.worker_id,
        renewal_enabled: plan.interval === 'month',
      }).catch(async error => {
        // SDK value validation happens before signing/broadcast. Unknown write
        // failures retain the receipt hold and require reconciliation.
        if (error instanceof ArkivInvalidValueError && deps.redis) await deps.redis.set(`${paymentKey}:preflight-retry`, id);
        throw error;
      });

      const paid = await store.markPaid(id, {
        payment_tx: body.payment_tx,
        customer_wallet: body.customer_wallet,
        grant_id: grant.id,
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
