import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '@bagseven/server';
import {
  assertKnownFeature,
  explorerUrl,
  getGrantStore,
  type Grant,
} from '@bagseven/entitlements';
import { add, gte } from '@bagseven/money';
import {
  assertCanRead,
  assertCanWrite,
  authenticateRequest,
  issueEmbedToken,
  type ApiPrincipal,
} from './api-keys.js';
import { settleAvalancheUsdt } from './avalanche-settle.js';
import type { GrantRouteDeps } from './grants.js';
import { claimSettlement } from './payment-ledger.js';
import { getFeatureValueType } from './feature-registry.js';

const consumeBody = z.object({
  feature: z.string().min(1),
  holder: z.string().min(1).optional(),
  amount: z.string().default('1'),
  idempotencyKey: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  grant_id: z.string().optional(),
}).refine((b) => Boolean((b.idempotencyKey ?? b.idempotency_key)?.trim()), {
  message: 'idempotencyKey is required',
  path: ['idempotencyKey'],
});

const tokenBody = z.object({
  holder: z.string().min(1),
  expiresIn: z.number().int().positive().max(3600).optional(),
});

const creditsBody = z.object({
  feature: z.string().min(1),
  holder: z.string().min(1).optional(),
  remaining: z.string().default('10'),
  ttl_seconds: z.number().int().positive().default(900),
  amount: z.string().default('1.00'),
  payment_tx: z.string().optional(),
  customer_wallet: z.string().optional(),
  payment_signature: z.string().optional(),
});

export function isPublicEntitlementPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (
    path === '/v1/check' ||
    path === '/v1/entitlements' ||
    path === '/v1/access-tokens' ||
    path === '/v1/credits' ||
    path === '/v1/usage/consume' ||
    path === '/v1/plans' ||
    path === '/v1/checkout-sessions'
  ) {
    return true;
  }
  if (path.startsWith('/v1/plans/')) return true;
  if (path.startsWith('/v1/checkout-sessions/')) return true;
  if (path.startsWith('/v1/public/checkout/')) return true;
  if (path === '/v1/subscriptions' || path.startsWith('/v1/subscriptions/')) return true;
  if (path.startsWith('/v1/entitlements/') && path.endsWith('/cancel-renewal')) return true;
  return false;
}

export async function entitlementView(grant: Grant | null, feature: string) {
  const valueType = await getFeatureValueType(feature);
  const notExpired = Boolean(grant) && new Date(grant!.paid_through).getTime() > Date.now();
  const live =
    Boolean(grant) &&
    grant!.enabled &&
    notExpired &&
    (valueType === 'boolean' ? true : Number(grant!.remaining) > 0);
  return {
    feature,
    value_type: valueType,
    enabled: live,
    /** ArcenPay-style boolean value — same as enabled for boolean features. */
    value: live,
    remaining: valueType === 'boolean' ? (live ? '1' : '0') : (grant?.remaining ?? '0'),
    allocation: valueType === 'boolean' ? (live ? '1' : '0') : (grant?.remaining ?? '0'),
    paid_through: grant?.paid_through ?? null,
    grant_id: grant?.id ?? null,
    updated_at: grant?.updated_at,
    registry_grant_id: grant?.registry_grant_id,
    registry_address: grant?.registry_address,
    payment_tx: grant?.payment_tx,
    explorer_url: grant?.payment_tx ? explorerUrl(grant.payment_tx) : null,
    settlement_network: grant?.settlement_network,
    renewal_enabled: grant?.renewal_enabled ?? false,
  };
}

function principalFrom(req: FastifyRequest): ApiPrincipal {
  return authenticateRequest(req.headers.authorization, process.env);
}

function holderFor(principal: ApiPrincipal, requested?: string): string {
  if (principal.kind === 'embed') return principal.holder;
  if (!requested) throw new ApiError(400, 'HOLDER_REQUIRED', 'holder is required');
  return requested;
}

export function registerPublicEntitlementRoutes(app: FastifyInstance, deps: GrantRouteDeps = {}): void {
  const store = getGrantStore(process.env);

  app.get('/v1/check', async (req) => {
    const principal = principalFrom(req);
    const q = req.query as { feature?: string; holder?: string };
    if (!q.feature) throw new ApiError(400, 'FEATURE_REQUIRED', 'feature is required');
    try {
      assertKnownFeature(q.feature);
    } catch (e) {
      throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
    }
    const holder = holderFor(principal, q.holder);
    assertCanRead(principal, holder);
    const live = await store.findLive({ feature: q.feature, holder });
    const grant = [...live].sort((a, b) => Number(b.remaining) - Number(a.remaining))[0] ?? null;
    return { ...await entitlementView(grant, q.feature), total_remaining: (await getFeatureValueType(q.feature)) === 'boolean' ? (grant ? '1' : '0') : live.reduce((sum, g) => add(sum, g.remaining), '0') };
  });

  app.get('/v1/entitlements', async (req) => {
    const principal = principalFrom(req);
    const q = req.query as { holder?: string; feature?: string };
    const holder = holderFor(principal, q.holder);
    assertCanRead(principal, holder);
    const grants = await store.findLive({ holder, feature: q.feature || undefined });
    return {
      holder,
      entitlements: await Promise.all(grants.map((g) => entitlementView(g, g.feature))),
      grants,
    };
  });

  /** Customer portal — cancel renewal; access stays until paid_through. */
  app.post('/v1/entitlements/:id/cancel-renewal', async (req) => {
    const principal = principalFrom(req);
    const { id } = req.params as { id: string };
    const grant = await store.get(id);
    if (!grant) throw new ApiError(404, 'GRANT_NOT_FOUND', 'grant not found');
    assertCanWrite(principal, grant.holder);
    if (principal.kind === 'embed' && principal.holder !== grant.holder) {
      throw new ApiError(403, 'HOLDER_MISMATCH', 'embed token is scoped to a different holder');
    }
    const draft = await deps.subscriptionCancellation?.(id);
    if (draft) return draft;
    const next = await store.cancelRenewal(id);
    return {
      entitlement: await entitlementView(next, next.feature),
      grant: next,
      note: 'Renewal off; access remains until paid_through',
    };
  });

  app.post('/v1/access-tokens', async (req) => {
    const principal = principalFrom(req);
    if (principal.kind !== 'sk') throw new ApiError(403, 'FORBIDDEN', 'secret key required to issue embed tokens');
    const body = tokenBody.parse(req.body ?? {});
    const token = issueEmbedToken(body.holder, process.env, body.expiresIn ?? 900);
    return { token, holder: body.holder, expires_in: body.expiresIn ?? 900 };
  });

  app.post('/v1/usage/consume', async (req) => {
    const principal = principalFrom(req);
    const body = consumeBody.parse(req.body ?? {});
    try {
      assertKnownFeature(body.feature);
    } catch (e) {
      throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
    }
    const holder = holderFor(principal, body.holder);
    assertCanWrite(principal, holder);

    let grantId = body.grant_id?.trim();
    if (!grantId) {
      const live = await store.findLive({ feature: body.feature, holder });
      const ranked = [...live].sort((a, b) => Number(b.remaining) - Number(a.remaining));
      const pick = ranked.find((g) => gte(g.remaining, body.amount)) ?? ranked[0];
      if (!pick) throw new ApiError(404, 'GRANT_NOT_FOUND', `No living ${body.feature} grant for ${holder}`);
      grantId = pick.id;
    }
    const grant = await store.get(grantId);
    if (!grant) throw new ApiError(404, 'GRANT_NOT_FOUND', 'grant not found');
    if (grant.feature !== body.feature) throw new ApiError(403, 'FEATURE_MISMATCH', 'grant does not cover the requested feature');
    if (grant.holder !== holder) throw new ApiError(403, 'HOLDER_MISMATCH', 'grant holder does not match');

    // Boolean features are on/off until TTL — check/access, do not burn credits.
    if ((await getFeatureValueType(body.feature)) === 'boolean') {
      const view = await entitlementView(grant, grant.feature);
      if (!view.enabled) throw new ApiError(403, 'FEATURE_OFF', `${body.feature} is not active`);
      return {
        entitlement: view,
        grant,
        dual_gate: { mandate: 'not_required', grant: 'ok' },
        note: 'boolean_feature',
      };
    }

    // Prepaid credits are access, regardless of whether a human or an agent
    // uses them. New payments are authorized on the worker spending path.
    const key = (body.idempotencyKey ?? body.idempotency_key)!.trim();
    const next = await store.consume(grantId, body.amount, key);
    return {
      entitlement: await entitlementView(next, next.feature),
      grant: next,
      dual_gate: { mandate: 'not_required', grant: 'ok' },
    };
  });

  app.post('/v1/credits', async (req) => {
    const principal = principalFrom(req);
    const body = creditsBody.parse(req.body ?? {});
    try {
      assertKnownFeature(body.feature);
    } catch (e) {
      throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
    }
    const holder = holderFor(principal, body.holder);
    assertCanWrite(principal, holder);
    const live = await store.findLive({ feature: body.feature, holder });
    const prior = [...live].sort((a, b) => Number(b.remaining) - Number(a.remaining))[0];
    if (!prior) {
      throw new ApiError(404, 'GRANT_NOT_FOUND', `No living ${body.feature} grant for ${holder} — mint with email and wallet first`);
    }
    const settlement = await settleAvalancheUsdt({
      amount: body.amount,
      feature: body.feature,
      holder,
      payment_tx: body.payment_tx,
      reason: 'sdk_credits',
      customer_wallet: body.customer_wallet,
      payment_signature: body.payment_signature,
    });
    await claimSettlement(settlement, deps);
    const grant = await store.mint({
      feature: body.feature,
      merchant: prior.merchant,
      holder,
      remaining: body.remaining,
      ttl_seconds: body.ttl_seconds,
      payment_tx: settlement.payment_tx,
      settlement_network: 'avalanche',
      human_id: prior.human_id,
      worker_id: prior.worker_id || process.env.BAGSEVEN_MCP_WORKER?.trim(),
      mandate_id: prior.mandate_id,
      renewal_enabled: true,
    });
    return { grant, entitlement: await entitlementView(grant, grant.feature), settlement };
  });
}
