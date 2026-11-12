import { createHash, createHmac } from 'node:crypto';

export type McpPrincipal = { humanId: string; accountWallet: string; clientId: string };
type Daemon = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>;
export const principalKey = (p: McpPrincipal | null) => createHash('sha256')
  .update(JSON.stringify(p ? [p.humanId, p.accountWallet.toLowerCase(), p.clientId] : ['local'])).digest('hex');

/** OAuth approves one account. A deployment-wide daemon token must not broaden it. */
export function scopedDaemon(principal: McpPrincipal, call: Daemon): Daemon {
  if (principal.clientId === 'static') return call; // Explicit operator service credential.
  const actor = principal.humanId.trim().toLowerCase();
  const assertHolder = (holder: unknown) => {
    if (holder !== undefined && holder !== null && String(holder).toLowerCase() !== actor) throw Error('HOLDER_MISMATCH: OAuth is scoped to the verified email account');
  };
  return async (method, path, body) => {
    const url = new URL(path, 'http://daemon.internal');
    const headers: Record<string, string> = { 'x-bagseven-actor': actor };
    let payload = body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
    if (payload?.holder) assertHolder(payload.holder);
    if (url.searchParams.has('holder')) assertHolder(url.searchParams.get('holder'));
    if (url.pathname === '/internal/grants/live' || url.pathname === '/v1/subscriptions') url.searchParams.set('holder', actor);
    if (typeof payload?.grant_id === 'string') await call('GET', `/internal/grants/${encodeURIComponent(payload.grant_id)}`, undefined, headers);
    if (url.pathname === '/internal/grants/explain-denial') payload = { ...payload, holder: actor };
    if (url.pathname.startsWith('/internal/workers/')) {
      const worker = url.pathname.split('/')[3];
      const status = await call('POST', `/internal/workers/${worker}/status`, undefined, headers) as { mandate?: { owner_address?: string } };
      if (status.mandate?.owner_address?.toLowerCase() !== principal.accountWallet.toLowerCase()) {
        throw Error('WORKER_OWNER_MISMATCH: connect the wallet that owns this spending permission');
      }
    }
    // Subscription routes accept the service credential; enforce its OAuth holder here.
    if (/^\/v1\/subscriptions\/[^/]+/.test(url.pathname)) {
      const target = url.pathname.split('/').slice(0, 4).join('/');
      const result = await call('GET', target, undefined, headers) as { subscription?: { holder?: string } };
      if (!result.subscription?.holder) throw Error('SUBSCRIPTION_NOT_FOUND');
      assertHolder(result.subscription.holder);
    }
    if (/^\/v1\/checkout-sessions\/[^/]+$/.test(url.pathname)) {
      const result = await call('GET', url.pathname, undefined, headers) as { session?: { holder?: string } };
      if (!result.session?.holder) throw Error('CHECKOUT_NOT_FOUND');
      assertHolder(result.session.holder);
    }
    if (url.pathname === '/v1/checkout-sessions' && method === 'GET') url.searchParams.set('holder', actor);
    if (url.pathname === '/v1/plans' && method === 'POST') {
      const secret = process.env.PROVIDER_SCOPE_SIGNING_KEY || (process.env.NODE_ENV !== 'production' ? process.env.PROVIDER_GAS_ENCRYPTION_KEY : undefined);
      if (!secret) throw Error('PROVIDER_SCOPE_REQUIRED');
      const data = Buffer.from(JSON.stringify({ provider: actor, expires: Date.now() + 60000 })).toString('base64url');
      headers['x-bagseven-provider'] = actor;
      headers['x-bagseven-provider-scope'] = `${data}.${createHmac('sha256', secret).update(`bagseven-provider-scope-v1:${data}`).digest('base64url')}`;
    }
    return call(method, `${url.pathname}${url.search}`, payload && url.pathname === '/v1/checkout-sessions' && method === 'POST'
      ? { ...payload, holder: actor } : payload ?? body, headers);
  };
}
