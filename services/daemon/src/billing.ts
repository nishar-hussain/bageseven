import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@bagseven/server';
import { getGrantStore } from '@bagseven/entitlements';
import { createPublicClient, http, parseAbiItem, type Hex } from 'viem';
import { WHITECHAIN_CHAIN_ID, WHITECHAIN_RPC_URL, whitechainSepolia } from '@bagseven/onchain';
import {
  assertCanRead,
  assertCanWrite,
  authenticateRequest,
  type ApiPrincipal,
} from './api-keys.js';
import {
  CreateCheckoutInput,
  CreatePlanInput,
  getBillingStore,
} from './billing-store.js';

const confirmBody = z.object({
  payment_tx: z.string().min(1),
  customer_wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

function principalFrom(auth: string | string[] | undefined): ApiPrincipal {
  return authenticateRequest(auth, process.env);
}

function holderFor(principal: ApiPrincipal, requested?: string): string {
  if (principal.kind === 'embed') return principal.holder;
  if (!requested) throw new ApiError(400, 'HOLDER_REQUIRED', 'holder is required');
  return requested;
}

async function verifyWhitechainPayment(opts: {
  payment_tx: string;
  merchant_wallet: string;
  customer_wallet: string;
  amount: string;
}): Promise<{ ok: true; mode: 'verified' | 'demo' } | { ok: false; reason: string }> {
  const tx = opts.payment_tx.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    return { ok: false, reason: 'payment_tx must be a 32-byte hex hash' };
  }

  const prod = (process.env.NODE_ENV ?? 'development') === 'production';
  const demo = (process.env.WHITECHAIN_DEMO_SETTLE ?? (prod ? 'false' : 'true')).toLowerCase() !== 'false';
  const rpc = (process.env.WHITECHAIN_RPC_URL ?? process.env.RPC_URL ?? WHITECHAIN_RPC_URL).trim();
  const usdt = (process.env.WHITECHAIN_USDT ?? '0xaa7962d073935D387e8d442DA1D7149C81388f46').trim();

  try {
    const client = createPublicClient({
      chain: whitechainSepolia,
      transport: http(rpc),
    });
    const receipt = await client.getTransactionReceipt({ hash: tx as Hex });
    if (receipt.status !== 'success') return { ok: false, reason: 'transaction failed on-chain' };

    const transferEvent = parseAbiItem(
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    );
    const logs = await client.getLogs({
      address: usdt as Hex,
      event: transferEvent,
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const from = opts.customer_wallet.toLowerCase();
    const to = opts.merchant_wallet.toLowerCase();
    const hit = logs.some((l) => {
      const args = l.args as { from?: string; to?: string };
      return args.from?.toLowerCase() === from && args.to?.toLowerCase() === to;
    });
    if (hit) return { ok: true, mode: 'verified' };
    // Buyer-signed native stamp or demo environments: receipt success is enough when demo settle is on.
    if (demo) return { ok: true, mode: 'demo' };
    return { ok: false, reason: 'no matching USDT Transfer log for customer→merchant' };
  } catch (e) {
    if (demo) return { ok: true, mode: 'demo' };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function registerBillingRoutes(app: FastifyInstance): void {
  const store = getBillingStore();
  const grants = getGrantStore(process.env);

  app.post('/v1/plans', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    if (principal.kind !== 'sk') throw new ApiError(403, 'FORBIDDEN', 'secret key required to create plans');
    try {
      const plan = store.createPlan(CreatePlanInput.parse(req.body ?? {}));
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
    return { plans: store.listPlans(q.active === 'true') };
  });

  app.get('/v1/plans/:id', async (req) => {
    principalFrom(req.headers.authorization);
    const { id } = req.params as { id: string };
    const plan = store.getPlan(id);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan not found');
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
      const session = store.createCheckout(body);
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
    return { sessions: store.listCheckouts({ holder: q.holder, plan_id: q.plan_id }) };
  });

  app.get('/v1/checkout-sessions/:id', async (req) => {
    const principal = principalFrom(req.headers.authorization);
    const { id } = req.params as { id: string };
    const session = store.getCheckout(id);
    if (!session) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    if (principal.kind === 'embed' && session.holder !== principal.holder) {
      throw new ApiError(403, 'HOLDER_MISMATCH', 'embed token is scoped to a different holder');
    }
    return { session };
  });

  /** Public resolve — no daemon Bearer; still requires session id knowledge. */
  app.get('/v1/public/checkout/:id', async (req) => {
    const { id } = req.params as { id: string };
    const session = store.getCheckout(id);
    if (!session) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    return {
      session: {
        id: session.id,
        status: session.status,
        amount: session.amount,
        chain_id: session.chain_id,
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
    const session = store.getCheckout(id);
    if (!session) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'checkout session not found');
    if (session.status === 'PAID') return { session, already_paid: true };
    if (session.status !== 'PENDING') throw new ApiError(409, `CHECKOUT_${session.status}`, `session is ${session.status}`);
    const plan = session.plan ?? store.getPlan(session.plan_id);
    if (!plan) throw new ApiError(404, 'PLAN_NOT_FOUND', 'plan missing');

    const verified = await verifyWhitechainPayment({
      payment_tx: body.payment_tx,
      merchant_wallet: plan.merchant_wallet,
      customer_wallet: body.customer_wallet,
      amount: plan.amount,
    });
    if (!verified.ok) {
      store.markFailed(id);
      throw new ApiError(402, 'PAYMENT_UNVERIFIED', verified.reason);
    }

    const live = await grants.findLive({ holder: session.holder, feature: plan.feature });
    const prior = live[0];
    const grant = await grants.mint({
      feature: plan.feature,
      holder: session.holder,
      remaining: plan.credits,
      ttl_seconds: plan.ttl_seconds,
      payment_tx: body.payment_tx,
      settlement_network: 'whitechain',
      human_id: prior?.human_id,
      world_proof_id: prior?.world_proof_id ?? `world:checkout:${session.id}`,
      worker_id: prior?.worker_id || process.env.BAGSEVEN_MCP_WORKER?.trim(),
      renewal_enabled: plan.interval === 'month',
    });

    const paid = store.markPaid(id, {
      payment_tx: body.payment_tx,
      customer_wallet: body.customer_wallet,
      grant_id: grant.id,
    });

    return {
      session: paid,
      grant,
      verification: verified.mode,
    };
  });
}

/** Keep unused helpers referenced for typed principal paths in future list filters. */
export const _billingHelpers = { holderFor, assertCanRead, assertCanWrite };
