import { createHmac, timingSafeEqual } from 'node:crypto';
import { authSecretFromEnv } from './session-crypto';
type Identity = { email?: string; exp: number; wallet_address?: string | null };
/** Native POST navigations may send Origin:null under no-referrer. Bind approval to the rendered session instead. */
export function mcpConsentCsrf(request: string, session: Identity) {
  return createHmac('sha256', authSecretFromEnv(process.env)).update(JSON.stringify(['mcp-consent-v1', request, session.email?.toLowerCase(), session.exp, session.wallet_address?.toLowerCase()])).digest('base64url');
}
export function validMcpConsentCsrf(request: string, session: Identity, token: unknown) {
  if (typeof token !== 'string' || token.length !== 43) return false;
  const expected = Buffer.from(mcpConsentCsrf(request, session)), actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
