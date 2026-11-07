import { createHmac } from 'node:crypto';
/** Server-only header. Never return this capability or its encryption secret to a browser. */
export function providerScopeHeaders(provider: string): Record<string, string> {
  const secret = process.env.PROVIDER_GAS_ENCRYPTION_KEY;
  if (!secret) return {};
  const payload = Buffer.from(JSON.stringify({ provider, expires: Date.now() + 60_000 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`bagseven-provider-scope-v1:${payload}`).digest('base64url');
  return { 'x-bagseven-provider-scope': `${payload}.${signature}` };
}
