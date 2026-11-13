import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@bagseven/server';
import { ProviderApiKeys, type Database } from '@bagseven/db';

export type ApiPrincipal = (
  | { kind: 'sk' }
  | { kind: 'pk' }
  | { kind: 'embed'; holder: string; exp: number; billingEmail?: string }) & { provider?: string; keyId?: string };
type ApiRequest = { headers: { authorization?: string | string[]; [key: string]: unknown } };
const requestPrincipals = new WeakMap<object, ApiPrincipal>();
export function authenticatedPrincipal(req: object) { return requestPrincipals.get(req); }
/** No cross-request auth cache: revocation also invalidates customer tokens from this key. */
export async function authenticateApiRequest(req: ApiRequest, db?: Database, env: NodeJS.ProcessEnv = process.env): Promise<ApiPrincipal> {
  const cached = requestPrincipals.get(req);
  if (cached) return cached;
  const token = bearer(req.headers.authorization);
  let principal: ApiPrincipal;
  if (/^bgs_(sk|pk)_/.test(token)) {
    if (!db) throw new ApiError(503, 'API_KEY_STORAGE_UNAVAILABLE', 'API key storage unavailable');
    const key = await new ProviderApiKeys(db).authenticate(token);
    if (!key) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid, expired or revoked API key');
    principal = { kind: key.kind, provider: key.provider_id, keyId: key.id };
  } else {
    principal = authenticateRequest(req.headers.authorization, env);
    if (principal.provider || principal.keyId) {
      if (!db) throw new ApiError(503, 'API_KEY_STORAGE_UNAVAILABLE', 'API key storage unavailable');
      if (!principal.provider || !principal.keyId || !await new ProviderApiKeys(db).active(principal.keyId, principal.provider)) throw new ApiError(401, 'UNAUTHORIZED', 'Customer token issuing key expired or revoked');
    }
  }
  requestPrincipals.set(req, principal);
  return principal;
}
export function assertProviderResource(principal: ApiPrincipal, merchant?: string) {
  if (principal.provider && principal.provider !== merchant) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
}

function bearer(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw.trim();
}

export function secretKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BAGSEVEN_SECRET_KEY ?? env.DAEMON_AUTH_TOKEN ?? '').trim();
}

export function publishableKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BAGSEVEN_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY ?? '').trim();
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function issueEmbedToken(holder: string, env: NodeJS.ProcessEnv = process.env, ttlSeconds = 900, billingEmail?: string, authority?: { provider?: string; keyId?: string }): string {
  const sk = secretKey(env);
  if (!sk) throw new ApiError(503, 'SECRET_UNCONFIGURED', 'BAGSEVEN_SECRET_KEY or DAEMON_AUTH_TOKEN required to issue embed tokens');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ v: 1, holder, exp, billingEmail, provider: authority?.provider, keyId: authority?.keyId }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', sk).update(payload).digest('base64url');
  return `bgs_tok_${payload}.${sig}`;
}

export function verifyEmbedToken(token: string, env: NodeJS.ProcessEnv = process.env): { holder: string; exp: number; billingEmail?: string; provider?: string; keyId?: string } {
  const sk = secretKey(env);
  if (!sk) throw new ApiError(401, 'UNAUTHORIZED', 'embed token cannot be verified');
  const raw = token.startsWith('bgs_tok_') ? token.slice('bgs_tok_'.length) : token;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) throw new ApiError(401, 'UNAUTHORIZED', 'malformed embed token');
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac('sha256', sk).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) throw new ApiError(401, 'UNAUTHORIZED', 'invalid embed token');
  let parsed: { v?: number; holder?: string; exp?: number; billingEmail?: string; provider?: string; keyId?: string };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'invalid embed token payload');
  }
  if (!parsed.holder || !parsed.exp) throw new ApiError(401, 'UNAUTHORIZED', 'embed token missing claims');
  if (parsed.exp * 1000 <= Date.now()) throw new ApiError(401, 'UNAUTHORIZED', 'embed token expired');
  if (parsed.provider || parsed.keyId) {
    if (typeof parsed.provider !== 'string' || !parsed.provider || typeof parsed.keyId !== 'string' || !/^[a-f0-9-]{36}$/i.test(parsed.keyId)) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token authority');
  }
  return { holder: parsed.holder, exp: parsed.exp, ...(parsed.billingEmail ? { billingEmail: parsed.billingEmail } : {}), ...(parsed.provider ? { provider: parsed.provider, keyId: parsed.keyId } : {}) };
}

export function authenticateRequest(
  authorization: string | string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ApiPrincipal {
  const token = bearer(authorization);
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'missing API key');

  if (token.startsWith('bgs_tok_')) {
    const embed = verifyEmbedToken(token, env);
    return { kind: 'embed', ...embed };
  }

  const pk = publishableKey(env);
  const sk = secretKey(env);
  const daemon = (env.DAEMON_AUTH_TOKEN ?? '').trim();
  if (pk && safeEqual(token, pk)) return { kind: 'pk' };
  if (sk && safeEqual(token, sk)) return { kind: 'sk' };
  if (daemon && safeEqual(token, daemon)) return { kind: 'sk' };
  throw new ApiError(401, 'UNAUTHORIZED', 'unknown API key');
}

export function assertCanRead(principal: ApiPrincipal, holder?: string): void {
  if (principal.kind === 'pk') throw new ApiError(403, 'FORBIDDEN', 'Customer access token required to read private customer access');
  if (principal.kind === 'embed' && holder && principal.holder !== holder) {
    throw new ApiError(403, 'HOLDER_MISMATCH', 'embed token is scoped to a different holder');
  }
}

export function assertCanWrite(principal: ApiPrincipal, holder?: string): void {
  if (principal.kind === 'pk') {
    throw new ApiError(403, 'FORBIDDEN', 'publishable keys cannot consume or mint; use a secret key or embed token');
  }
  if (principal.kind === 'embed' && holder && principal.holder !== holder) {
    throw new ApiError(403, 'HOLDER_MISMATCH', 'embed token is scoped to a different holder');
  }
}
