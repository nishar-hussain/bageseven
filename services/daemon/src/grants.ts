import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '@bagseven/server';
import { getGrantStore, MintGrantInputSchema } from '@bagseven/entitlements';
import {
  buildWorldAuthorizeUrl,
  pkceChallengeFromVerifier,
  verifyWorldAgentPass,
  worldDeniedMessage,
} from '@bagseven/world';
import { gte } from '@bagseven/money';
import type { FastifyInstance } from 'fastify';
import { settleHederaX402, buildHcsJoin } from './hedera-x402.js';
import { notifyOperator } from '@bagseven/notify';

function actorEmail(req: { headers: { [key: string]: string | string[] | undefined } }): string | undefined {
  const raw = req.headers['x-bagseven-actor'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : undefined;
}

const consumeSchema = z.object({
  grant_id: z.string().min(1),
  amount: z.string().default('1'),
  idempotency_key: z.string().min(1).optional(),
  work: z.string().max(2000).optional(),
  worker_id: z.string().optional(),
  /** When true, skip mandate capacity check (tests only). */
  skip_mandate_gate: z.boolean().optional(),
});

const holdSchema = z.object({
  grant_id: z.string().min(1),
  amount: z.string().min(1),
  hold_id: z.string().min(1).optional(),
});

const buyCreditsSchema = z.object({
  feature: z.string().min(1).default('ocr'),
  holder: z.string().min(1),
  remaining: z.string().default('10'),
  ttl_seconds: z.number().int().positive().default(120),
  payment_tx: z.string().optional(),
  human_id: z.string().optional(),
  worker_id: z.string().optional(),
  mandate_id: z.string().optional(),
  amount: z.string().default('1.00'),
  world_proof_id: z.string().optional(),
  id_token: z.string().optional(),
  world_denied: z.boolean().optional(),
  outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
});

const explainSchema = z.object({
  worker_id: z.string().optional(),
  grant_id: z.string().optional(),
  feature: z.string().optional(),
  holder: z.string().optional(),
  amount: z.string().default('1'),
  world_proof_id: z.string().optional(),
  world_denied: z.boolean().optional(),
  outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
});

export type MandateCapacity = {
  ok: boolean;
  reason?: string;
  remaining_window?: string;
  remaining_lifetime?: string;
  vault_available?: string;
  mandate_id?: string;
};

export type GrantRouteDeps = {
  /** Dual-gate: mandate money ceiling for a worker. */
  resolveMandateCapacity?: (workerId: string) => Promise<MandateCapacity>;
};

function mapGrantError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(':')[0] ?? 'GRANT_ERROR';
  const status =
    code === 'GRANT_NOT_FOUND' || code === 'HOLD_NOT_FOUND' ? 404
      : code === 'WORLD_DENIED' || code === 'GRANT_DISABLED' || code === 'GRANT_EXPIRED' || code === 'GRANT_EMPTY' || code === 'MANDATE_EMPTY' || code === 'DUAL_GATE' ? 403
        : code === 'HOLD_EXISTS' || code === 'IDEMPOTENCY_CONFLICT' ? 409
          : 400;
  throw new ApiError(status, code, message);
}

/** Public entitlement routes — access clock beside mandate spend. */
export function registerGrantRoutes(app: FastifyInstance, deps: GrantRouteDeps = {}): void {
  const store = getGrantStore(process.env);

  app.get('/internal/mumbai/status', async () => {
    const hasArkiv = Boolean(process.env.ARKIV_ACCESS_KEY && (process.env.ARKIV_PRIVATE_KEY || process.env.PRIVATE_KEY));
    const hederaNetwork = process.env.HEDERA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    return {
      tracks: {
        world: {
          enabled: (process.env.WORLD_AGENT_PASS_ENABLED ?? 'true').toLowerCase() !== 'false',
          mode: process.env.WORLD_CLIENT_ID ? 'live' : 'mock',
          mock_proofs: (process.env.WORLD_MOCK_PROOFS ?? 'true').toLowerCase() !== 'false',
        },
        hedera: {
          network: hederaNetwork,
          facilitator: Boolean(process.env.HEDERA_X402_FACILITATOR_URL),
          demo_settle: (process.env.HEDERA_DEMO_SETTLE ?? 'true').toLowerCase() !== 'false',
          hcs_topic: process.env.HEDERA_HCS_TOPIC_ID ?? null,
        },
        arkiv: {
          live: hasArkiv,
          store: hasArkiv ? 'arkiv' : 'memory',
        },
      },
      dual_gate: {
        require_grant: (process.env.BAGSEVEN_REQUIRE_GRANT ?? 'true').toLowerCase() !== 'false',
        feature: process.env.BAGSEVEN_GRANT_FEATURE ?? 'ocr',
      },
    };
  });

  // PKCE verifiers stay server-side only (never returned to the browser).
  const pkceByState = new Map<string, { verifier: string; exp: number }>();

  app.get('/internal/world/authorize', async (req) => {
    const q = req.query as { redirect_uri?: string; state?: string };
    const clientId = process.env.WORLD_CLIENT_ID?.trim();
    if (!clientId) {
      return {
        mode: 'mock',
        note: 'WORLD_CLIENT_ID unset — use world:ok:<id> proofs locally',
        authorize_url: null,
      };
    }
    const redirectUri = q.redirect_uri || process.env.WORLD_REDIRECT_URI || 'http://127.0.0.1:3000/app/mint';
    const state = q.state || randomUUID();
    const verifier = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    pkceByState.set(state, { verifier, exp: Date.now() + 15 * 60 * 1000 });
    const challenge = pkceChallengeFromVerifier(verifier);
    const authorize_url = buildWorldAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
    });
    return {
      mode: 'live',
      authorize_url,
      state,
      redirect_uri: redirectUri,
      note: 'Complete Agent Pass, then POST id_token to /internal/grants/mint (PKCE verifier is server-held)',
    };
  });

  app.get('/internal/grants/live', async (req) => {
    const q = req.query as { holder?: string; feature?: string; worker_id?: string };
    const grants = await store.findLive({
      holder: q.holder,
      feature: q.feature,
      worker_id: q.worker_id,
    });
    return {
      grants,
      physics: {
        payment: 'Hedera x402 / HashScan',
        renewal: 'grant.renewal_enabled',
        access: 'Arkiv-queryable grant until paid_through / ExpirationTime',
      },
      store: typeof (store as unknown as { describe?: () => unknown }).describe === 'function'
        ? (store as unknown as { describe: () => unknown }).describe()
        : { mode: 'memory' },
    };
  });

  app.get('/internal/grants/:id', async (req) => {
    const { id } = req.params as { id: string };
    const grant = await store.get(id);
    if (!grant) throw new ApiError(404, 'GRANT_NOT_FOUND', 'grant not found');
    const ttl_ms = Math.max(0, new Date(grant.paid_through).getTime() - Date.now());
    const network = process.env.HEDERA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    return {
      grant,
      ttl_seconds: Math.floor(ttl_ms / 1000),
      hashscan_url: grant.payment_tx
        ? `https://hashscan.io/${network}/transaction/${encodeURIComponent(grant.payment_tx)}`
        : null,
    };
  });

  app.post('/internal/grants/mint', async (req) => {
    try {
      const body = MintGrantInputSchema.parse(req.body);
      const world = await verifyWorldAgentPass({
        world_proof_id: body.world_proof_id,
        id_token: body.id_token,
        world_denied: body.world_denied,
        outcome: body.outcome,
        human_id: body.human_id,
      });
      if (!world.ok) {
        void notifyOperator(
          'world_denied',
          'World mint denied',
          'A mint was refused — nothing was written to Arkiv.',
          {
            reason: world.reason,
            detail: world.detail,
            holder: body.holder,
          },
          actorEmail(req),
        );
        throw new ApiError(403, 'WORLD_DENIED', worldDeniedMessage(world), world);
      }

      let settlement: Awaited<ReturnType<typeof settleHederaX402>> | null = null;
      if (body.settlement_network === 'hedera') {
        settlement = await settleHederaX402({
          amount: body.remaining,
          feature: body.feature,
          holder: body.holder,
          payment_tx: body.payment_tx,
        });
      }

      const grant = await store.mint({
        ...body,
        human_id: world.human_id,
        world_proof_id: world.world_proof_id,
        payment_tx: settlement?.payment_tx ?? body.payment_tx,
        settlement_network: settlement ? 'hedera' : body.settlement_network,
        world_denied: false,
      });
      void notifyOperator(
        'grant_minted',
        'Entitlement minted',
        'A living Arkiv grant is on the query surface.',
        {
          grant_id: grant.id,
          holder: grant.holder,
          remaining: grant.remaining,
          paid_through: grant.paid_through,
          payment_tx: grant.payment_tx ?? '',
        },
        actorEmail(req),
      );
      return {
        grant,
        world: { ok: true, mode: world.mode, human_id: world.human_id },
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

  /** Hedera settle → mint/extend grant (buy_credits hero path). */
  app.post('/internal/grants/buy-credits', async (req) => {
    try {
      const body = buyCreditsSchema.parse(req.body);
      const prod = (process.env.NODE_ENV ?? 'development') === 'production';
      const world = await verifyWorldAgentPass({
        world_proof_id: body.world_proof_id ?? (prod ? undefined : 'world:ok:buyer'),
        id_token: body.id_token,
        world_denied: body.world_denied,
        outcome: body.outcome,
        human_id: body.human_id,
      });
      if (!world.ok) {
        throw new ApiError(403, 'WORLD_DENIED', worldDeniedMessage(world), world);
      }

      const settlement = await settleHederaX402({
        amount: body.amount,
        feature: body.feature,
        holder: body.holder,
        payment_tx: body.payment_tx,
        reason: 'buy_credits',
      });

      const grant = await store.mint({
        feature: body.feature,
        holder: body.holder,
        remaining: body.remaining,
        ttl_seconds: body.ttl_seconds,
        human_id: world.human_id,
        world_proof_id: world.world_proof_id,
        payment_tx: settlement.payment_tx,
        settlement_network: 'hedera',
        worker_id: body.worker_id,
        mandate_id: body.mandate_id,
        renewal_enabled: true,
      });

      void notifyOperator(
        'credits_bought',
        'Credits settled on Hedera',
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
        hcs_join: buildHcsJoin({ payment_tx: settlement.payment_tx, grant_id: grant.id }),
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
   * Dual-gate work unit: mandate capacity AND living grant with remaining >= cost.
   * Either fail → refuse (use explain-denial for structured why).
   */
  app.post('/internal/grants/paid-run', async (req) => {
    try {
      const body = consumeSchema.parse(req.body);
      const grant = await store.get(body.grant_id);
      if (!grant) throw new ApiError(404, 'GRANT_NOT_FOUND', 'grant not found');

      const now = Date.now();
      if (!grant.enabled) {
        throw new ApiError(403, 'DUAL_GATE', 'GRANT_DISABLED: grant is disabled');
      }
      if (new Date(grant.paid_through).getTime() <= now) {
        throw new ApiError(403, 'DUAL_GATE', 'GRANT_EXPIRED: access left the query surface');
      }
      if (!gte(grant.remaining, body.amount)) {
        throw new ApiError(403, 'DUAL_GATE', 'GRANT_EMPTY: remaining credits insufficient');
      }

      const prod = (process.env.NODE_ENV ?? 'development') === 'production';
      const skipMandate = prod ? false : Boolean(body.skip_mandate_gate);
      if (!skipMandate && body.worker_id && deps.resolveMandateCapacity) {
        const capacity = await deps.resolveMandateCapacity(body.worker_id);
        if (!capacity.ok) {
          throw new ApiError(
            403,
            'DUAL_GATE',
            `MANDATE_EMPTY: ${capacity.reason ?? 'mandate capacity insufficient'}`,
            capacity,
          );
        }
      }

      const key = body.idempotency_key ?? randomUUID();
      const next = await store.consume(body.grant_id, body.amount, key);
      const hcs_join = next.payment_tx
        ? buildHcsJoin({ payment_tx: next.payment_tx, grant_id: next.id, consume_id: key })
        : null;

      void notifyOperator(
        'paid_run',
        'Paid run completed',
        'Dual-gate spend burned grant credits.',
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
        dual_gate: { mandate: 'ok', grant: 'ok' },
        hcs_join,
        note: 'Dual gate passed: mandate ceiling + living Arkiv grant',
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
      const key = body.idempotency_key ?? randomUUID();
      const grant = await store.consume(body.grant_id, body.amount, key);
      return {
        grant,
        work_echo: body.work ?? null,
        note: 'Grant credits burned; use /paid-run for dual-gate (mandate + grant)',
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      mapGrantError(error);
    }
  });

  app.post('/internal/grants/explain-denial', async (req) => {
    const body = explainSchema.parse(req.body ?? {});
    const reasons: Array<{ code: string; detail: string }> = [];

    if (body.world_denied || (body.outcome && body.outcome !== 'ok') || body.world_proof_id?.startsWith('world:deny') || body.world_proof_id?.startsWith('world:cancel') || body.world_proof_id?.startsWith('world:expire')) {
      const world = await verifyWorldAgentPass({
        world_proof_id: body.world_proof_id,
        world_denied: body.world_denied,
        outcome: body.outcome,
      });
      if (!world.ok) {
        reasons.push({ code: 'WORLD_DENIED', detail: `${world.reason}: ${world.detail}` });
      }
    }

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
        reasons.push({ code: 'GRANT_EXPIRED', detail: 'no living grant on Arkiv query surface for filters' });
      }
    }

    if (body.worker_id && deps.resolveMandateCapacity) {
      const capacity = await deps.resolveMandateCapacity(body.worker_id);
      if (!capacity.ok) {
        reasons.push({ code: 'MANDATE_EMPTY', detail: capacity.reason ?? 'mandate capacity insufficient' });
      }
    }

    if (reasons.length === 0) {
      reasons.push({ code: 'NONE', detail: 'no denial detected for supplied inputs — dual gate would allow' });
    }

    return {
      denied: reasons[0]?.code !== 'NONE',
      reasons,
      clocks: ['payment (Hedera)', 'renewal (flag)', 'access (Arkiv TTL)'],
    };
  });

  app.post('/internal/grants/:id/cancel-renewal', async (req) => {
    try {
      const { id } = req.params as { id: string };
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
