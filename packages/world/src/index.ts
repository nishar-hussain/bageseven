import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { z } from 'zod';

/** Explicit fail outcomes for the World deny/expire/cancel demo path. */
export const WorldFailOutcomeSchema = z.enum(['denied', 'expired', 'cancelled', 'invalid']);
export type WorldFailOutcome = z.infer<typeof WorldFailOutcomeSchema>;

export const VerifyWorldInputSchema = z.object({
  world_proof_id: z.string().optional(),
  id_token: z.string().optional(),
  outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
  world_denied: z.boolean().optional(),
  human_id: z.string().optional(),
});

export type VerifyWorldInput = z.infer<typeof VerifyWorldInputSchema>;

export type WorldVerifyOk = {
  ok: true;
  human_id: string;
  world_proof_id: string;
  mode: 'live' | 'mock';
  issuer: string;
};

export type WorldVerifyFail = {
  ok: false;
  code: 'WORLD_DENIED';
  reason: WorldFailOutcome;
  detail: string;
  mode: 'live' | 'mock';
};

export type WorldVerifyResult = WorldVerifyOk | WorldVerifyFail;

const ISSUER = 'https://auth.world.org';
const DISCOVERY = 'https://auth.world.org/.well-known/openid-configuration';

let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

type JsonWebKey = {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
};

function fail(reason: WorldFailOutcome, detail: string, mode: 'live' | 'mock'): WorldVerifyFail {
  return { ok: false, code: 'WORLD_DENIED', reason, detail, mode };
}

function decodeJwtPart(part: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function b64urlToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

async function fetchJwks(): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000) return jwksCache.keys;
  const discovery = (await fetch(DISCOVERY).then((r) => r.json())) as { jwks_uri?: string };
  if (!discovery.jwks_uri) throw new Error('World discovery missing jwks_uri');
  const jwks = (await fetch(discovery.jwks_uri).then((r) => r.json())) as { keys?: JsonWebKey[] };
  const keys = jwks.keys ?? [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

function jwkToPem(jwk: JsonWebKey): string {
  const keyObject = createPublicKey({ key: jwk as object, format: 'jwk' });
  return keyObject.export({ type: 'spki', format: 'pem' }).toString();
}

async function verifyRs256Jwt(token: string, audience: string): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('id_token must have 3 parts');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const header = decodeJwtPart(headerB64);
  const payload = decodeJwtPart(payloadB64);
  if (!header || !payload) throw new Error('invalid JWT encoding');
  if (header.alg !== 'RS256') throw new Error(`unsupported alg ${String(header.alg)}`);

  const keys = await fetchJwks();
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const candidates = kid ? keys.filter((k) => k.kid === kid) : keys.filter((k) => k.kty === 'RSA');
  if (candidates.length === 0) throw new Error('no matching JWKS key');

  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBuffer(sigB64);
  let ok = false;
  for (const jwk of candidates) {
    const verify = createVerify('RSA-SHA256');
    verify.update(data);
    verify.end();
    if (verify.verify(jwkToPem(jwk), signature)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error('id_token signature invalid');

  if (payload.iss !== ISSUER && payload.iss !== `${ISSUER}/`) {
    throw new Error(`unexpected issuer ${String(payload.iss)}`);
  }
  const aud = payload.aud;
  const audOk = aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audOk) throw new Error('id_token audience mismatch');
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp * 1000 <= Date.now()) throw new Error('id_token expired');
  return payload;
}

/** Build World OIDC authorize URL for Agent Pass (PKCE expected by client). */
export function buildWorldAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce?: string;
  codeChallenge?: string;
  scope?: string;
}): string {
  const url = new URL('https://auth.world.org/authorize');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scope ?? 'openid');
  url.searchParams.set('state', input.state);
  if (input.nonce) url.searchParams.set('nonce', input.nonce);
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export function pkceChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Backend World Agent Pass verification.
 * - WORLD_AGENT_PASS_ENABLED=false → always WORLD_DENIED
 * - Live when WORLD_CLIENT_ID set: JWKS RS256 verify of id_token
 * - Else mock proofs when WORLD_MOCK_PROOFS!=false
 */
export async function verifyWorldAgentPass(
  raw: VerifyWorldInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorldVerifyResult> {
  const input = VerifyWorldInputSchema.parse(raw);
  if ((env.WORLD_AGENT_PASS_ENABLED ?? 'true').toLowerCase() === 'false') {
    return fail('denied', 'WORLD_AGENT_PASS_ENABLED=false', 'mock');
  }

  const clientId = env.WORLD_CLIENT_ID?.trim();
  const mockAllowed = (env.WORLD_MOCK_PROOFS ?? 'true').toLowerCase() !== 'false';
  const mode: 'live' | 'mock' = clientId ? 'live' : 'mock';

  if (input.world_denied) {
    return fail('denied', 'world_denied=true — Agent Pass unsuccessful; no grant written', mode);
  }
  if (input.outcome && input.outcome !== 'ok') {
    return fail(input.outcome, `Agent Pass outcome=${input.outcome}; no grant written`, mode);
  }

  const proof = input.world_proof_id?.trim() ?? '';
  if (proof.startsWith('world:deny:')) return fail('denied', 'proof marked denied', mode);
  if (proof.startsWith('world:expire:')) return fail('expired', 'proof / session expired', mode);
  if (proof.startsWith('world:cancel:')) return fail('cancelled', 'user cancelled Agent Pass', mode);
  if (proof.startsWith('world:invalid:')) return fail('invalid', 'malformed or forged proof', mode);

  if (mode === 'live') {
    if (!input.id_token) {
      return fail('invalid', 'live mode requires id_token from Agent Pass callback', 'live');
    }
    try {
      const skipJwks = (env.WORLD_SKIP_JWKS ?? '').toLowerCase() === 'true';
      let payload: Record<string, unknown>;
      if (skipJwks) {
        const decoded = decodeJwtPart(input.id_token.split('.')[1] ?? '');
        if (!decoded) return fail('invalid', 'id_token is not a JWT', 'live');
        payload = decoded;
        if (payload.iss !== ISSUER && payload.iss !== `${ISSUER}/`) {
          return fail('invalid', `unexpected issuer ${String(payload.iss)}`, 'live');
        }
        const aud = payload.aud;
        const audOk = aud === clientId || (Array.isArray(aud) && aud.includes(clientId!));
        if (!audOk) return fail('invalid', 'id_token audience mismatch', 'live');
        const exp = typeof payload.exp === 'number' ? payload.exp : 0;
        if (exp * 1000 <= Date.now()) return fail('expired', 'id_token expired', 'live');
      } else {
        payload = await verifyRs256Jwt(input.id_token, clientId!);
      }
      const sub = typeof payload.sub === 'string' ? payload.sub : '';
      if (!sub) return fail('invalid', 'id_token missing sub', 'live');
      const exp = typeof payload.exp === 'number' ? payload.exp : 0;
      return {
        ok: true,
        human_id: input.human_id ?? `world:${sub}`,
        world_proof_id: proof || `oidc:${sub}:${exp}`,
        mode: 'live',
        issuer: ISSUER,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('expired')) return fail('expired', message, 'live');
      return fail('invalid', message, 'live');
    }
  }

  if (!mockAllowed) {
    return fail('invalid', 'WORLD_MOCK_PROOFS=false and WORLD_CLIENT_ID unset', 'mock');
  }

  if (proof && !proof.startsWith('world:ok:') && proof.length < 4) {
    return fail('invalid', 'mock proof too short', 'mock');
  }

  const human =
    input.human_id ??
    (proof.startsWith('world:ok:') ? proof.slice('world:ok:'.length) : undefined) ??
    `human:mock:${Date.now()}`;

  return {
    ok: true,
    human_id: human,
    world_proof_id: proof || `world:ok:${human}`,
    mode: 'mock',
    issuer: ISSUER,
  };
}

export function worldDeniedMessage(result: WorldVerifyFail): string {
  return `WORLD_DENIED: ${result.reason} — ${result.detail}`;
}
