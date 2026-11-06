import { createHmac, timingSafeEqual } from 'node:crypto';
import { authSecretFromEnv } from './session-crypto';

export const WORLD_CONTINUITY_COOKIE = 'bagseven_world_continuity';
export const WORLD_CONTINUITY_AGE = 60 * 60 * 24 * 90;
const sessionIdPattern = /^session_[a-zA-Z0-9_-]+$/;

/** This cookie remembers which World session to prove; it never authenticates a user. */
export function signWorldContinuity(sessionId: string): string {
  if (!sessionIdPattern.test(sessionId)) throw new Error('Invalid World session ID');
  const data = Buffer.from(JSON.stringify({ session_id: sessionId, exp: Math.floor(Date.now() / 1000) + WORLD_CONTINUITY_AGE })).toString('base64url');
  return `${data}.${createHmac('sha256', authSecretFromEnv(process.env)).update(data).digest('base64url')}`;
}

export function readWorldContinuity(value?: string): string | undefined {
  if (!value || value.length > 4096) return undefined;
  const [data, signature, extra] = value.split('.');
  if (!data || !signature || extra) return undefined;
  const expected = createHmac('sha256', authSecretFromEnv(process.env)).update(data).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (typeof decoded.exp !== 'number' || decoded.exp <= Date.now() / 1000 || typeof decoded.session_id !== 'string' || !sessionIdPattern.test(decoded.session_id)) return undefined;
    return decoded.session_id;
  } catch { return undefined; }
}
