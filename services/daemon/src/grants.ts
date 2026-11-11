import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '@bagseven/server';
import {
  assertKnownFeature,
  DEFAULT_FEATURE_ID,
  explorerUrl,
  featureForAction,
  getGrantStore,
  MintGrantInputSchema,
} from '@bagseven/entitlements';
import { createFeature, getFeatureValueType, listFeatures } from './feature-registry.js';
import { gte } from '@bagseven/money';
import type { FastifyInstance } from 'fastify';
import { resolveAvalanchePayTo, settleAvalancheUsdt, avalancheDemoAllowed } from './avalanche-settle.js';
import { notifyConfigured, notifyOperator } from '@bagseven/notify';
import { claimSettlement, type PaymentLedger } from './payment-ledger.js';
import { providerGasEnabled, avalancheConfig } from '@bagseven/onchain';
import { providerFromRequest } from './provider-gas.js';

function actorEmail(req: { headers: { [key: string]: string | string[] | undefined } }): string | undefined {
  const raw = req.headers['x-bagseven-actor'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : undefined;
}

/** Keep dashboard grants on the same worker as the server's MCP instance. */
function resolveWorkerId(requested?: string, bound?: string): string | undefined {
  return requested?.trim() || bound?.trim() || process.env.BAGSEVEN_MCP_WORKER?.trim() || undefined;
}

const consumeSchema = z.object({
  /** Optional — when omitted, pick the richest living grant for feature (+ optional holder). */
  grant_id: z.string().min(1).optional(),
  feature: z.string().optional(),
  holder: z.string().optional(),
  amount: z.string().default('1'),
  idempotency_key: z.string().min(1).optional(),
  work: z.string().max(2000).optional(),
  worker_id: z.string().optional(),
});

const holdSchema = z.object({
  grant_id: z.string().min(1),
  amount: z.string().min(1),
  hold_id: z.string().min(1).optional(),
});

const buyCreditsSchema = z.object({
  feature: z.string().min(1).default(DEFAULT_FEATURE_ID),
  holder: z.string().min(1),
  remaining: z.string().default('10'),
  ttl_seconds: z.number().int().positive().default(120),
  payment_tx: z.string().optional(),
  customer_wallet: z.string().optional(),
  payment_signature: z.string().optional(),
  human_id: z.string().optional(),
  worker_id: z.string().optional(),
  mandate_id: z.string().optional(),
  amount: z.string().default('1.00'),
});

const explainSchema = z.object({
  worker_id: z.string().optional(),
  grant_id: z.string().optional(),
  feature: z.string().optional(),
  holder: z.string().optional(),
  amount: z.string().default('1'),
  operation: z.enum(['access', 'payment']).default('access'),
});

export type MandateCapacity = {
  ok: boolean;
  reason?: string;
  remaining_window?: string;
  remaining_lifetime?: string;
  vault_available?: string;
  mandate_id?: string;
};

export type GrantRouteDeps = PaymentLedger & {
  subscriptionCancellation?: (grantId: string) => Promise<unknown | null>;
  /** Dual-gate: mandate money ceiling for a worker. */
  resolveMandateCapacity?: (workerId: string, amount?: string) => Promise<MandateCapacity>;
};

function mapGrantError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(':')[0] ?? 'GRANT_ERROR';
  const status =
    code === 'GRANT_NOT_FOUND' || code === 'HOLD_NOT_FOUND' ? 404
      : code === 'GRANT_DISABLED' || code === 'GRANT_EXPIRED' || code === 'GRANT_EMPTY' || code === 'MANDATE_EMPTY' || code === 'DUAL_GATE' ? 403
        : code === 'HOLD_EXISTS' || code === 'IDEMPOTENCY_CONFLICT' ? 409
          : 400;
  throw new ApiError(status, code, message);
}

/** Public entitlement routes — access clock beside mandate spend. */
export function registerGrantRoutes(app: FastifyInstance, deps: GrantRouteDeps = {}): void {
  const store = getGrantStore(process.env);
  app.get('/internal/mumbai/status', async () => {
    const hasRegistry = store.describe().mode === 'avalanche';
    const avalancheNetwork = process.env.AVALANCHE_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    return {
      notifications: { delivery: notifyConfigured() ? 'resend' : 'log' },
      tracks: {
        auth: { mode: 'email_wallet' },
        avalanche: {
          network: avalancheNetwork,
          chain_id: Number(process.env.CHAIN_ID ?? 43113),
          explorer: process.env.AVALANCHE_NETWORK === 'mainnet' ? 'https://snowtrace.io' : 'https://testnet.snowtrace.io',
          operator: Boolean((process.env.AVALANCHE_PRIVATE_KEY ?? '').trim() && Boolean(resolveAvalanchePayTo())),
          demo_settle: avalancheDemoAllowed(),
          pay_to: resolveAvalanchePayTo(),
          usdt: avalancheConfig().usdt,
        },
        registry: {
          live: hasRegistry,
          store: hasRegistry ? 'avalanche' : 'memory',
        },
      },
      dual_gate: {
        provider_funded_gas: providerGasEnabled(process.env),
        prepaid_access_requires_mandate: false,
        payment_requires_mandate: true,
        require_grant: (process.env.BAGSEVEN_REQUIRE_GRANT ?? 'true').toLowerCase() !== 'false',
        /** @deprecated Prefer `features` — scalar kept for older clients. */
        feature: process.env.BAGSEVEN_GRANT_FEATURE ?? DEFAULT_FEATURE_ID,
        features: listFeatures().map((f) => ({
          id: f.id,
          label: f.label,
          actions: f.actions,
          builtin: f.builtin,
          value_type: f.value_type,
        })),
        fetch_feature: featureForAction('fetch'),
      },
    };
  });

  /** Built-in + operator-created feature SKUs (Schematic / ArcenPay-style catalog). */
  app.get('/internal/features', async () => ({ features: listFeatures() }));

  app.post('/internal/features', async (req) => {
    const body = z
      .object({
        id: z.string().min(2).max(64),
        label: z.string().max(80).optional(),
        blurb: z.string().max(200).optional(),
        value_type: z.enum(['boolean', 'numeric']).optional(),
        actions: z.array(z.string().min(1)).max(12).optional(),
      })
      .parse(req.body ?? {});
    try {
      const feature = createFeature(body);
      return { feature };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('FEATURE_EXISTS')) throw new ApiError(409, 'FEATURE_EXISTS', msg);
      if (msg.startsWith('INVALID_FEATURE')) throw new ApiError(400, 'INVALID_FEATURE', msg);
      throw e;
    }
  });

  app.get('/internal/grants/live', async (req) => {
    const q = req.query as { holder?: string; feature?: string; worker_id?: string };
    const actor = typeof req.headers['x-bagseven-actor'] === 'string' ? req.headers['x-bagseven-actor'].trim() : '';
    if (actor && q.holder && actor.toLowerCase() !== q.holder.toLowerCase()) throw new ApiError(403, 'FORBIDDEN', 'holder does not match authenticated actor');
    const grants = await store.findLive({
      holder: actor || q.holder,
      feature: q.feature || undefined,
      worker_id: q.worker_id,
    });
    return {
      grants,
      physics: {
        payment: 'Avalanche USDT',
        renewal: 'grant.renewal_enabled',
        access: 'Registry-queryable grant until paid_through / ExpirationTime',
      },
      store: store.describe(),
      features: listFeatures().map((f) => f.id),
    };
  });

  app.get('/internal/grants/:id', async (req) => {
    const { id } = req.params as { id: string };
    const grant = await store.get(id);
    if (!grant) throw new ApiError(404, 'GRANT_NOT_FOUND', 'grant not found');
    const actor = typeof req.headers['x-bagseven-actor'] === 'string' ? req.headers['x-bagseven-actor'] : '';
    if (actor && grant.holder.toLowerCase() !== actor.toLowerCase()) {
      throw new ApiError(403, 'FORBIDDEN', 'grant belongs to another holder');
    }
    const ttl_ms = Math.max(0, new Date(grant.paid_through).getTime() - Date.now());
    return {
      grant,
      ttl_seconds: Math.floor(ttl_ms / 1000),
      explorer_url: grant.payment_tx ? explorerUrl(grant.payment_tx) : null,
    };
  });

  app.post('/internal/grants/mint', async (req) => {
    try {
      if (providerGasEnabled(process.env)) throw new ApiError(409, 'PROVIDER_CHECKOUT_REQUIRED', 'Choose a provider plan in Create entitlement and complete its wallet checkout');
      const body = MintGrantInputSchema.parse(req.body);
      const merchant = providerGasEnabled(process.env) ? providerFromRequest(req, process.env) : undefined;
      if (body.settlement_network === 'local' && process.env.NODE_ENV === 'production') throw new ApiError(403, 'LIVE_PAYMENT_REQUIRED', 'Live entitlements require a verified Avalanche payment');
      try {
        assertKnownFeature(body.feature);
      } catch (e) {
        throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
      }


      const valueType = getFeatureValueType(body.feature);
      // Boolean = on/off access on Registry until TTL. Numeric = metered credits.
      const remaining = valueType === 'boolean' ? '1' : body.remaining;
      const settleAmount = valueType === 'boolean' ? (body.remaining === '1' ? '1' : body.remaining) : body.remaining;

      let settlement: Awaited<ReturnType<typeof settleAvalancheUsdt>> | null = null;
      if (body.settlement_network !== 'local') {
        settlement = await settleAvalancheUsdt({
          amount: settleAmount,
          feature: body.feature,
          holder: body.holder,
          payment_tx: body.payment_tx,
          customer_wallet: body.customer_wallet,
          payment_signature: body.payment_signature,
        });
      }
      if (settlement) await claimSettlement(settlement, deps);

      const grant = await store.mint({
        ...body,
        merchant,
        remaining,
        worker_id: resolveWorkerId(body.worker_id),
        payment_tx: settlement?.payment_tx ?? body.payment_tx,
        settlement_network: settlement ? 'avalanche' : body.settlement_network,
      });
      void notifyOperator(
        'grant_minted',
        'Entitlement minted',
        valueType === 'boolean'
          ? 'Boolean Registry entitlement is live until paid_through.'
          : 'A living Registry grant is on the query surface.',
        {
          grant_id: grant.id,
          holder: grant.holder,
          remaining: grant.remaining,
          value_type: valueType,
          paid_through: grant.paid_through,
          payment_tx: grant.payment_tx ?? '',
        },
        actorEmail(req),
      );
      return {
        grant,
        settlement,
        clocks: {
          payment: Boolean(grant.payment_tx),
          renewal: grant.renewal_enabled,
          access: true,
          paid_through: grant.paid_through,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'ZodError') {
        throw new ApiError(400, 'VALIDATION', 'Invalid mint payload', error);
      }
      mapGrantError(error);
    }
  });

  /** Avalanche settle → mint/extend grant (buy_credits hero path). */
  app.post('/internal/grants/buy-credits', async (req) => {
    try {
      if (providerGasEnabled(process.env)) throw new ApiError(409, 'PROVIDER_CHECKOUT_REQUIRED', 'Choose a provider plan in Buy credits and complete its wallet checkout');
      const body = buyCreditsSchema.parse(req.body);
      const merchant = providerGasEnabled(process.env) ? providerFromRequest(req, process.env) : undefined;
      try {
        assertKnownFeature(body.feature);
      } catch (e) {
        throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
      }


      const settlement = await settleAvalancheUsdt({
        amount: body.amount,
        feature: body.feature,
        holder: body.holder,
        payment_tx: body.payment_tx,
        reason: 'buy_credits',
        customer_wallet: body.customer_wallet,
        payment_signature: body.payment_signature,
      });
      await claimSettlement(settlement, deps);

      const grant = await store.mint({
        feature: body.feature,
        merchant,
        holder: body.holder,
        remaining: body.remaining,
        ttl_seconds: body.ttl_seconds,
        payment_tx: settlement.payment_tx,
        settlement_network: 'avalanche',
        worker_id: resolveWorkerId(body.worker_id),
        mandate_id: body.mandate_id,
        renewal_enabled: true,
      });

      void notifyOperator(
        'credits_bought',
        'Credits settled on Avalanche',
        'buy_credits stamped payment_tx on a living grant.',
        {
          grant_id: grant.id,
          holder: grant.holder,
          remaining: grant.remaining,
          payment_tx: settlement.payment_tx,
          mode: settlement.mode,
        },
        actorEmail(req),
      );

      return {
        grant,
        settlement,
        clocks: {
          payment: true,
          renewal: true,
          access: true,
          paid_through: grant.paid_through,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      mapGrantError(error);
    }
  });

  /**
   * Prepaid work unit: a living grant with remaining >= credit cost.
   * New USDT payments use the separate worker spending path.
   */
  app.post('/internal/grants/paid-run', async (req) => {
    try {
      const body = consumeSchema.parse(req.body);
      const actor = typeof req.headers['x-bagseven-actor'] === 'string' ? req.headers['x-bagseven-actor'].trim() : '';
      let grantId = body.grant_id?.trim();
      if (!grantId) {
        // Explicit feature only — omit filter to pick richest living grant across SKUs.
        const feature = featureForAction('paid_run', body.feature);
        const live = await store.findLive({
          feature,
          holder: actor || body.holder?.trim() || undefined,
        });
        const eligible = live.filter(g => !body.worker_id || !g.worker_id || g.worker_id === body.worker_id);
        const ranked = eligible.sort((a, b) => Number(b.remaining) - Number(a.remaining));
        const pick = ranked.find((g) => gte(g.remaining, body.amount)) ?? ranked[0];
        if (!pick) {
          throw new ApiError(
            404,
            'GRANT_NOT_FOUND',
            `No living${feature ? ` ${feature}` : ''} grant${body.holder ? ` for ${body.holder}` : ''} — create an entitlement first`,
          );
        }
        grantId = pick.id;
      }

      const grant = await store.get(grantId);
      if (!grant) throw new ApiError(404, 'GRANT_NOT_FOUND', 'grant not found');

      if (body.feature && grant.feature !== body.feature) throw new ApiError(403, 'FEATURE_MISMATCH', 'grant does not cover the requested feature');

      if (actor) {
        if (grant.holder.toLowerCase() !== actor.toLowerCase()) {
          throw new ApiError(403, 'FORBIDDEN', 'cannot spend another holder’s entitlement');
        }
        if (body.holder?.trim() && body.holder.trim().toLowerCase() !== actor.toLowerCase()) {
          throw new ApiError(403, 'FORBIDDEN', 'holder does not match authenticated actor');
        }
      }

      const now = Date.now();
      if (!grant.enabled) {
        throw new ApiError(403, 'DUAL_GATE', 'GRANT_DISABLED: grant is disabled');
      }
      if (new Date(grant.paid_through).getTime() <= now) {
        throw new ApiError(403, 'DUAL_GATE', 'GRANT_EXPIRED: access left the query surface');
      }
      const valueType = getFeatureValueType(grant.feature);
      if (grant.worker_id && body.worker_id && grant.worker_id !== body.worker_id) throw new ApiError(403, 'GRANT_WORKER_MISMATCH', 'This entitlement is bound to another agent');

      // This endpoint consumes already-paid service credits. Credit units are
      // not USDT amounts; only payment execution checks a spending mandate.
      // Boolean features: access check only — do not burn Registry remaining.
      if (valueType === 'boolean') {
        return {
          grant,
          work_echo: body.work ?? null,
          dual_gate: { mandate: 'not_required', grant: 'ok' },
          note: 'Boolean entitlement active on Registry until paid_through',
        };
      }

      const key = body.idempotency_key ?? randomUUID();
      // The store resolves an existing operation before checking remaining
      // credits, so retrying the final successful burn still returns its result.
      const next = await store.consume(grantId, body.amount, key);

      void notifyOperator(
        'paid_run',
        'Paid run completed',
        'Prepaid entitlement credits consumed; no new payment was made.',
        {
          grant_id: next.id,
          remaining: next.remaining,
          amount: body.amount,
        },
        actorEmail(req),
      );

      return {
        grant: next,
        work_echo: body.work ?? null,
        dual_gate: { mandate: 'not_required', grant: 'ok' },
        note: 'Prepaid access used; no USDT spent',
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      mapGrantError(error);
    }
  });

  app.post('/internal/grants/consume', async (req) => {
    // Back-compat: prefer paid-run; consume alone still burns credits (grant gate only).
    try {
      const body = consumeSchema.parse(req.body);
      if (!body.grant_id) throw new ApiError(400, 'GRANT_ID_REQUIRED', 'grant_id required for /consume; use /paid-run to auto-pick');
      const key = body.idempotency_key ?? randomUUID();
      const grant = await store.consume(body.grant_id, body.amount, key);
      return {
        grant,
        work_echo: body.work ?? null,
        note: 'Grant credits consumed; /paid-run also checks holder and worker binding',
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      mapGrantError(error);
    }
  });

  app.post('/internal/grants/explain-denial', async (req) => {
    const body = explainSchema.parse(req.body ?? {});
    const reasons: Array<{ code: string; detail: string }> = [];

    if (body.grant_id) {
      const grant = await store.get(body.grant_id);
      if (!grant) reasons.push({ code: 'GRANT_NOT_FOUND', detail: 'no grant with that id' });
      else {
        if (!grant.enabled) reasons.push({ code: 'GRANT_DISABLED', detail: 'grant disabled' });
        if (new Date(grant.paid_through).getTime() <= Date.now()) {
          reasons.push({ code: 'GRANT_EXPIRED', detail: `paid_through=${grant.paid_through}` });
        }
        if (!gte(grant.remaining, body.amount)) {
          reasons.push({ code: 'GRANT_EMPTY', detail: `remaining=${grant.remaining} need=${body.amount}` });
        }
      }
    } else if (body.feature || body.holder) {
      const live = await store.findLive({ feature: body.feature, holder: body.holder, worker_id: body.worker_id });
      if (live.length === 0) {
        reasons.push({ code: 'GRANT_EXPIRED', detail: 'no living grant on Registry query surface for filters' });
      }
    }

    if (body.operation === 'payment' && body.worker_id && deps.resolveMandateCapacity) {
      const capacity = await deps.resolveMandateCapacity(body.worker_id, body.amount);
      if (!capacity.ok) {
        reasons.push({ code: 'MANDATE_EMPTY', detail: capacity.reason ?? 'mandate capacity insufficient' });
      }
    }

    if (reasons.length === 0) {
      reasons.push({ code: 'NONE', detail: 'no denial detected for supplied inputs' });
    }

    return {
      denied: reasons[0]?.code !== 'NONE',
      reasons,
      clocks: ['payment (Avalanche)', 'renewal (flag)', 'access (Registry TTL)'],
    };
  });

  app.post('/internal/grants/:id/cancel-renewal', async (req) => {
    const actor = typeof req.headers['x-bagseven-actor'] === 'string' ? req.headers['x-bagseven-actor'].trim() : '';
    if (actor) {
      const existing = await store.get((req.params as { id: string }).id);
      if (existing && existing.holder.toLowerCase() !== actor.toLowerCase()) {
        throw new ApiError(403, 'FORBIDDEN', 'grant belongs to another holder');
      }
    }
    try {
      const { id } = req.params as { id: string };
      const draft = await deps.subscriptionCancellation?.(id);
      if (draft) return draft;
      const grant = await store.cancelRenewal(id);
      void notifyOperator(
        'renewal_cancelled',
        'Renewal cancelled',
        'Access stays until paid_through — renewal flag is off.',
        {
          grant_id: grant.id,
          paid_through: grant.paid_through,
        },
        actorEmail(req),
      );
      return {
        grant,
        clocks: {
          payment: Boolean(grant.payment_tx),
          renewal: false,
          access: new Date(grant.paid_through).getTime() > Date.now(),
          note: 'Renewal off; access remains until paid_through',
        },
      };
    } catch (error) {
      mapGrantError(error);
    }
  });

  app.post('/internal/grants/hold', async (req) => {
    try {
      const body = holdSchema.parse(req.body);
      const holdId = body.hold_id ?? randomUUID();
      const grant = await store.hold(body.grant_id, body.amount, holdId);
      return { grant, hold_id: holdId };
    } catch (error) {
      mapGrantError(error);
    }
  });

  app.post('/internal/grants/hold/:holdId/commit', async (req) => {
    try {
      const { holdId } = req.params as { holdId: string };
      const grant = await store.commit(holdId);
      return { grant };
    } catch (error) {
      mapGrantError(error);
    }
  });

  app.post('/internal/grants/hold/:holdId/release', async (req) => {
    try {
      const { holdId } = req.params as { holdId: string };
      const grant = await store.release(holdId);
      return { grant };
    } catch (error) {
      mapGrantError(error);
    }
  });
}
