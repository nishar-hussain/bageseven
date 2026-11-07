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
import {
  assertWorldCallbackIssuer,
  buildWorldAuthorizeUrl,
  exchangeWorldAuthorizationCode,
  pkceChallengeFromVerifier,
  signWorldIdKitRequest,
  verifyWorldAgentPass,
  verifyWorldIdKitProof,
  worldDeniedMessage,
  worldIdKitConfig,
  worldMocksAllowed,
} from '@bagseven/world';
import { gte } from '@bagseven/money';
import type { FastifyInstance } from 'fastify';
import { resolveWhitechainPayTo, settleWhitechainUsdt, whitechainDemoAllowed } from './whitechain-settle.js';
import { notifyConfigured, notifyOperator } from '@bagseven/notify';
import { claimSettlement, type PaymentLedger } from './payment-ledger.js';
import { whitechainConfig } from '@bagseven/onchain';

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
  world_proof_id: z.string().optional(),
  id_token: z.string().optional(),
  world_denied: z.boolean().optional(),
  outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
});

type WorldOk = {
  ok: true;
  human_id: string;
  world_proof_id: string;
  mode: 'live' | 'mock' | 'idkit';
  issuer?: string;
};

const explainSchema = z.object({
  worker_id: z.string().optional(),
  grant_id: z.string().optional(),
  feature: z.string().optional(),
  holder: z.string().optional(),
  amount: z.string().default('1'),
  operation: z.enum(['access', 'payment']).default('access'),
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

export type GrantRouteDeps = PaymentLedger & {
  /** Dual-gate: mandate money ceiling for a worker. */
  resolveMandateCapacity?: (workerId: string, amount?: string) => Promise<MandateCapacity>;
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
  const challenges = new Map<string, { action: string; purpose: 'login' | 'mint' | 'session'; expires: number; sessionId?: string }>();

  function takeChallenge(response: unknown, purpose: 'login' | 'mint' | 'session'): string {
    const nonce = (response as { nonce?: unknown } | null)?.nonce;
    const challenge = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (challenge && challenge.purpose === purpose && challenge.expires > Date.now()) {
      challenges.delete(nonce as string);
      return challenge.action;
    }
    throw new ApiError(403, 'WORLD_CHALLENGE_INVALID', 'Start a new World ID verification; the request is missing, expired, or already used');
  }

  app.get('/internal/mumbai/status', async () => {
    const hasArkiv = Boolean(process.env.ARKIV_ACCESS_KEY && (process.env.ARKIV_PRIVATE_KEY || process.env.PRIVATE_KEY));
    const whitechainNetwork = process.env.WHITECHAIN_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    const worldConfig = worldIdKitConfig();
    const idkit = worldConfig.idkit;
    const agentPass = Boolean(process.env.WORLD_CLIENT_ID?.trim() && process.env.WORLD_CLIENT_SECRET?.trim());
    const mode = idkit && agentPass ? 'dual' : idkit ? 'idkit' : agentPass ? 'agent_pass' : worldConfig.mock_proofs ? 'mock' : 'unconfigured';
    return {
      notifications: { delivery: notifyConfigured() ? 'resend' : 'log' },
      tracks: {
        world: {
          enabled: (process.env.WORLD_AGENT_PASS_ENABLED ?? 'true').toLowerCase() !== 'false',
          mode,
          mock_proofs: worldConfig.mock_proofs,
          idkit,
          agent_pass: agentPass,
          /** IDKit Developer Portal app (proof of human). */
          app_id: process.env.WORLD_APP_ID || null,
          rp_id: process.env.WORLD_RP_ID || null,
          action: worldConfig.action,
          login_action: worldConfig.login_action,
          login_signal: worldConfig.login_signal,
          environment: worldConfig.environment,
          signing_configured: worldConfig.signing_configured,
          /** World IdP OIDC client (Agent Pass) — separate from app_id. */
          oidc_client_id: process.env.WORLD_CLIENT_ID || null,
        },
        whitechain: {
          network: whitechainNetwork,
          chain_id: Number(process.env.CHAIN_ID ?? 1874),
          explorer: process.env.WHITECHAIN_NETWORK === 'mainnet' ? 'https://explorer.whitechain.io' : 'https://explorer.testnet.whitechain.io',
          operator: Boolean((process.env.WHITECHAIN_PRIVATE_KEY ?? '').trim() && Boolean(resolveWhitechainPayTo())),
          demo_settle: whitechainDemoAllowed(),
          pay_to: resolveWhitechainPayTo(),
          usdt: whitechainConfig().usdt,
        },
        arkiv: {
          live: hasArkiv,
          store: hasArkiv ? 'arkiv' : 'memory',
        },
      },
      dual_gate: {
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

  // PKCE verifiers + nonce stay server-side only (World IdP OIDC / Agent Pass).
  const pkceByState = new Map<
    string,
    { verifier: string; redirectUri: string; nonce: string; exp: number }
  >();

  app.get('/internal/world/authorize', async (req) => {
    const q = req.query as { redirect_uri?: string; state?: string };
    const clientId = process.env.WORLD_CLIENT_ID?.trim();
    const clientSecret = process.env.WORLD_CLIENT_SECRET?.trim();
    // Agent Pass uses World IdP OIDC credentials — NOT the IDKit app_id/rp_id pair.
    if (!clientId || !clientSecret) {
      return {
        mode: 'unconfigured',
        note:
          'Agent Pass needs WORLD_CLIENT_ID + WORLD_CLIENT_SECRET from https://auth.world.org/portal (separate from IDKit app_id). Register redirect http://127.0.0.1:3000/app/mint',
        authorize_url: null,
        agent_pass: false,
        mock: false,
      };
    }
    const redirectUri = q.redirect_uri || process.env.WORLD_REDIRECT_URI || 'http://127.0.0.1:3000/app/mint';
    const state = q.state || randomUUID();
    const nonce = randomUUID().replace(/-/g, '');
    const verifier = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    pkceByState.set(state, { verifier, redirectUri, nonce, exp: Date.now() + 15 * 60 * 1000 });
    const challenge = pkceChallengeFromVerifier(verifier);
    const authorize_url = buildWorldAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
      scope: 'openid',
    });
    return {
      mode: 'agent_pass',
      authorize_url,
      state,
      redirect_uri: redirectUri,
      agent_pass: true,
      note: 'Complete World Agent Pass (OIDC). Bagseven holds PKCE verifier server-side and exchanges the code for an id_token.',
    };
  });

  /** Redeem World OIDC authorization code → verified id_token (server-held PKCE). */
  app.post('/internal/world/callback', async (req) => {
    const body = z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
        redirect_uri: z.string().url().optional(),
        /** RFC 9207 issuer from redirect query — required by World IdP docs. */
        iss: z.string().url().optional(),
      })
      .parse(req.body);

    const clientId = process.env.WORLD_CLIENT_ID?.trim();
    const clientSecret = process.env.WORLD_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new ApiError(
        400,
        'WORLD_NOT_CONFIGURED',
        'Agent Pass requires WORLD_CLIENT_ID + WORLD_CLIENT_SECRET from auth.world.org/portal',
      );
    }

    if (body.iss) {
      try {
        assertWorldCallbackIssuer(body.iss);
      } catch (error) {
        throw new ApiError(400, 'WORLD_ISS_INVALID', error instanceof Error ? error.message : String(error));
      }
    }

    const row = pkceByState.get(body.state);
    pkceByState.delete(body.state);
    if (!row || row.exp < Date.now()) {
      throw new ApiError(400, 'WORLD_STATE_INVALID', 'World OAuth state expired or unknown — start Agent Pass again');
    }
    const redirectUri = body.redirect_uri || row.redirectUri;

    let tokens: { id_token: string };
    try {
      tokens = await exchangeWorldAuthorizationCode({
        code: body.code,
        redirectUri,
        clientId,
        clientSecret,
        codeVerifier: row.verifier,
      });
    } catch (error) {
      throw new ApiError(400, 'WORLD_TOKEN_EXCHANGE', error instanceof Error ? error.message : String(error));
    }

    const world = await verifyWorldAgentPass({ id_token: tokens.id_token, nonce: row.nonce });
    if (!world.ok) {
      throw new ApiError(403, world.code, worldDeniedMessage(world), { reason: world.reason, mode: world.mode });
    }

    return {
      ok: true,
      id_token: tokens.id_token,
      human_id: world.human_id,
      world_proof_id: world.world_proof_id,
      mode: 'agent_pass',
    };
  });

  /** IDKit RP signature — never expose WORLD_RP_SIGNING_KEY to the browser. */
  app.post('/internal/world/rp-signature', async (req) => {
    const body = z
      .object({
        action: z.string().min(1).optional(),
        purpose: z.enum(['login', 'mint', 'session']).default('mint'),
        existing_session_id: z.string().regex(/^session_[a-zA-Z0-9_-]+$/).optional(),
      })
      .parse(req.body ?? {});
    const signingKey = process.env.WORLD_RP_SIGNING_KEY?.trim();
    const config = worldIdKitConfig();
    if (!signingKey || !config.idkit) {
      throw new ApiError(503, 'WORLD_NOT_CONFIGURED', 'Configure WORLD_APP_ID, WORLD_RP_ID, and WORLD_RP_SIGNING_KEY on the server');
    }
    // Login and mint use different actions so mint uniqueness does not burn login (and vice versa).
    const action =
      body.purpose === 'session' ? undefined : body.purpose === 'login' ? config.login_action : config.action;
    if (body.action && action && body.action !== action) {
      throw new ApiError(400, 'WORLD_ACTION_INVALID', 'Action does not match the configured World app');
    }
    const sig = signWorldIdKitRequest({
      signingKeyHex: signingKey,
      action,
      expectedSignerAddress: process.env.WORLD_SIGNER_ADDRESS,
    });
    for (const [nonce, challenge] of challenges) if (challenge.expires <= Date.now()) challenges.delete(nonce);
    if (challenges.size >= 5000) throw new ApiError(429, 'WORLD_BUSY', 'Too many pending World verifications; try again shortly');
    challenges.set(sig.nonce, { action: action ?? '', purpose: body.purpose, expires: sig.expires_at * 1000, sessionId: body.existing_session_id });
    return {
      ...sig,
      action: action ?? null,
      login_action: config.login_action,
      rp_id: config.rp_id,
      app_id: config.app_id,
      environment: config.environment,
      purpose: body.purpose,
    };
  });

  /** Session proofs authorize repeat sign-in without replaying a one-time action. */
  app.post('/internal/world/verify-idkit-session', async (req) => {
    const body = z.object({ idkit_response: z.unknown() }).parse(req.body);
    const nonce = (body.idkit_response as { nonce?: string })?.nonce;
    const existingSession = nonce ? challenges.get(nonce)?.sessionId : undefined;
    takeChallenge(body.idkit_response, 'session');
    const verified = await verifyWorldIdKitProof({
      rpId: worldIdKitConfig().rp_id, idkitResponse: body.idkit_response,
      expectedEnvironment: worldIdKitConfig().environment,
      sessionProof: true, expectedSessionId: existingSession,
    });
    if (!verified.ok) throw new ApiError(403, verified.code, verified.detail);
    return { ...verified, returning: Boolean(existingSession), mode: 'idkit' };
  });

  /** Verify a one-time IDKit proof. World must explicitly accept the proof. */
  app.post('/internal/world/verify-idkit', async (req) => {
    const body = z
      .object({
        idkit_response: z.unknown(),
        action: z.string().optional(),
      })
      .parse(req.body ?? {});
    const rpId = process.env.WORLD_RP_ID?.trim();
    if (!rpId) throw new ApiError(400, 'WORLD_NOT_CONFIGURED', 'WORLD_RP_ID is not set');
    const action = takeChallenge(body.idkit_response, 'login');
    const verified = await verifyWorldIdKitProof({
      rpId,
      idkitResponse: body.idkit_response,
      expectedEnvironment: process.env.WORLD_IDKIT_ENVIRONMENT || 'production',
      expectedAction: action,
    });
    if (!verified.ok) {
      throw new ApiError(403, verified.code, verified.detail);
    }
    return {
      ok: true,
      human_id: verified.human_id,
      world_proof_id: verified.world_proof_id,
      nullifier: verified.nullifier,
      action: verified.action,
      session_id: verified.session_id ?? null,
      returning: Boolean(verified.returning),
      mode: 'idkit',
    };
  });

  app.post('/internal/world/verify-session', async (req) => {
    const body = z.object({ id_token: z.string().min(1) }).parse(req.body);
    const verified = await verifyWorldAgentPass({ id_token: body.id_token });
    if (!verified.ok || verified.mode !== 'live') throw new ApiError(403, 'WORLD_DENIED', 'A verified World Agent Pass token is required');
    return verified;
  });

  async function resolveWorldForWrite(opts: {
    idkitResponse?: unknown;
    world_proof_id?: string;
    id_token?: string;
    world_denied?: boolean;
    outcome?: 'ok' | 'denied' | 'expired' | 'cancelled' | 'invalid';
    human_id?: string;
    holder: string;
    nullifierScope: 'mint' | 'buy';
    /** buy-credits: reuse prior living grant World proof when no new proof given */
    allowPriorGrant?: boolean;
    feature?: string;
    req: { headers: { [key: string]: string | string[] | undefined } };
  }): Promise<WorldOk> {
    const verifiedSession = opts.req.headers['x-bagseven-world-human'];
    if (typeof verifiedSession === 'string' && verifiedSession) {
      // This header is supplied only by the authenticated console BFF after
      // validating its signed, non-mock World session. Never accept it publicly.
      return { ok: true, human_id: verifiedSession, world_proof_id: `world:idkit:session:${verifiedSession}`, mode: 'idkit' };
    }
    if (opts.idkitResponse !== undefined) {
      const rpId = process.env.WORLD_RP_ID?.trim();
      if (!rpId) throw new ApiError(400, 'WORLD_NOT_CONFIGURED', 'WORLD_RP_ID is not set for IDKit');
      const action = takeChallenge(opts.idkitResponse, 'mint');
      const verified = await verifyWorldIdKitProof({
        rpId,
        idkitResponse: opts.idkitResponse,
        expectedEnvironment: process.env.WORLD_IDKIT_ENVIRONMENT || 'production',
        expectedAction: action,
      });
      if (!verified.ok) {
        void notifyOperator(
          'world_denied',
          'World IDKit denied',
          'Nothing was written to Arkiv.',
          { detail: verified.detail, holder: opts.holder },
          actorEmail(opts.req),
        );
        throw new ApiError(403, verified.code, verified.detail);
      }
      // A human may purchase again. The one-time request nonce prevents proof
      // replay; the persistent payment ledger prevents crediting a receipt twice.
      return {
        ok: true,
        human_id: verified.human_id,
        world_proof_id: verified.world_proof_id,
        mode: 'idkit',
        issuer: 'https://developer.world.org',
      };
    }

    if (opts.allowPriorGrant && opts.feature) {
      const living = await store.findLive({ holder: opts.holder, feature: opts.feature });
      const prior = living.find((g) => worldMocksAllowed() || g.world_proof_id?.startsWith('world:idkit:') || g.world_proof_id?.startsWith('oidc:'));
      if (prior?.world_proof_id || prior?.human_id) {
        return {
          ok: true,
          human_id: prior.human_id ?? opts.holder,
          world_proof_id: prior.world_proof_id ?? `world:prior:${prior.id}`,
          mode: 'idkit',
        };
      }
    }

    const checked = await verifyWorldAgentPass({
      world_proof_id: opts.world_proof_id,
      id_token: opts.id_token,
      world_denied: opts.world_denied,
      outcome: opts.outcome,
      human_id: opts.human_id,
    });
    if (!checked.ok) {
      void notifyOperator(
        'world_denied',
        'World mint denied',
        'Nothing was written to Arkiv.',
        { reason: checked.reason, detail: checked.detail, holder: opts.holder },
        actorEmail(opts.req),
      );
      throw new ApiError(
        403,
        'WORLD_DENIED',
        opts.allowPriorGrant
          ? `${worldDeniedMessage(checked)} — mint with World ID first, or pass idkit_response`
          : worldDeniedMessage(checked),
        checked,
      );
    }
    return checked;
  }

  app.get('/internal/grants/live', async (req) => {
    const q = req.query as { holder?: string; feature?: string; worker_id?: string };
    const grants = await store.findLive({
      holder: q.holder,
      feature: q.feature || undefined,
      worker_id: q.worker_id,
    });
    return {
      grants,
      physics: {
        payment: 'Whitechain USDT',
        renewal: 'grant.renewal_enabled',
        access: 'Arkiv-queryable grant until paid_through / ExpirationTime',
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
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const idkitResponse = rawBody.idkit_response;
      const body = MintGrantInputSchema.parse(req.body);
      if (body.settlement_network === 'local' && !worldMocksAllowed()) throw new ApiError(403, 'LIVE_PAYMENT_REQUIRED', 'Live entitlements require a verified Whitechain payment');
      try {
        assertKnownFeature(body.feature);
      } catch (e) {
        throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
      }

      const world = await resolveWorldForWrite({
        idkitResponse,
        world_proof_id: body.world_proof_id,
        id_token: body.id_token,
        world_denied: body.world_denied,
        outcome: body.outcome,
        human_id: body.human_id,
        holder: body.holder,
        nullifierScope: 'mint',
        req,
      });

      const valueType = getFeatureValueType(body.feature);
      // Boolean = on/off access on Arkiv until TTL. Numeric = metered credits.
      const remaining = valueType === 'boolean' ? '1' : body.remaining;
      const settleAmount = valueType === 'boolean' ? (body.remaining === '1' ? '1' : body.remaining) : body.remaining;

      let settlement: Awaited<ReturnType<typeof settleWhitechainUsdt>> | null = null;
      if (body.settlement_network !== 'local') {
        settlement = await settleWhitechainUsdt({
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
        remaining,
        worker_id: resolveWorkerId(body.worker_id),
        human_id: world.human_id,
        world_proof_id: world.world_proof_id,
        payment_tx: settlement?.payment_tx ?? body.payment_tx,
        settlement_network: settlement ? 'whitechain' : body.settlement_network,
        world_denied: false,
      });
      void notifyOperator(
        'grant_minted',
        'Entitlement minted',
        valueType === 'boolean'
          ? 'Boolean Arkiv entitlement is live until paid_through.'
          : 'A living Arkiv grant is on the query surface.',
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

  /** Whitechain settle → mint/extend grant (buy_credits hero path). */
  app.post('/internal/grants/buy-credits', async (req) => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const idkitResponse = rawBody.idkit_response;
      const body = buyCreditsSchema.parse(req.body);
      try {
        assertKnownFeature(body.feature);
      } catch (e) {
        throw new ApiError(400, 'UNKNOWN_FEATURE', e instanceof Error ? e.message : String(e));
      }

      const prod = (process.env.NODE_ENV ?? 'development') === 'production';
      const world = await resolveWorldForWrite({
        idkitResponse,
        world_proof_id: body.world_proof_id ?? (prod || idkitResponse !== undefined ? undefined : 'world:ok:buyer'),
        id_token: body.id_token,
        world_denied: body.world_denied,
        outcome: body.outcome,
        human_id: body.human_id,
        holder: body.holder,
        nullifierScope: 'buy',
        allowPriorGrant: idkitResponse === undefined,
        feature: body.feature,
        req,
      });

      const settlement = await settleWhitechainUsdt({
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
        holder: body.holder,
        remaining: body.remaining,
        ttl_seconds: body.ttl_seconds,
        human_id: world.human_id,
        world_proof_id: world.world_proof_id,
        payment_tx: settlement.payment_tx,
        settlement_network: 'whitechain',
        worker_id: resolveWorkerId(body.worker_id),
        mandate_id: body.mandate_id,
        renewal_enabled: true,
      });

      void notifyOperator(
        'credits_bought',
        'Credits settled on Whitechain',
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
      // Boolean features: access check only — do not burn Arkiv remaining.
      if (valueType === 'boolean') {
        return {
          grant,
          work_echo: body.work ?? null,
          dual_gate: { mandate: 'not_required', grant: 'ok' },
          note: 'Boolean entitlement active on Arkiv until paid_through',
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
      clocks: ['payment (Whitechain)', 'renewal (flag)', 'access (Arkiv TTL)'],
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
