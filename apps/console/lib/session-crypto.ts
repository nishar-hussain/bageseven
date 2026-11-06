/** Edge-safe session token verify (HMAC-SHA256 + base64url), shared by middleware. */

export type SessionClaims = { email: string; exp: number; k?: 'session' | 'magic' };

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function authSecretFromEnv(env: { AUTH_SECRET?: string; DAEMON_AUTH_TOKEN?: string; NODE_ENV?: string }): string {
  const secret = env.AUTH_SECRET?.trim() || '';
  if (secret) return secret;
  if ((env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }
  return env.DAEMON_AUTH_TOKEN?.trim() || 'dev-only-change-me';
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  kind: 'session' | 'magic' = 'session',
): Promise<SessionClaims | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  if (!timingSafeEqual(b64url(mac), sig)) return null;
  try {
    const session = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as SessionClaims;
    if (!session.email || session.exp * 1000 < Date.now()) return null;
    if (session.k && session.k !== kind && kind === 'session' && session.k === 'magic') return null;
    if (kind === 'session' && session.k === 'magic') return null;
    if (kind === 'magic' && session.k && session.k !== 'magic') return null;
    return session;
  } catch {
    return null;
  }
}
