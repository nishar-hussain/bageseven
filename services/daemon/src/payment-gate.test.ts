import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { errorResponse, type ServiceDeps } from '@bagseven/server';
import { getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import { buildRoutes } from './index.js';
const key = `0x${'01'.repeat(32)}` as const;
const address = privateKeyToAccount(key).address;
const worker = '110c3d3f-a158-4b12-bf91-2da6666fc44a';
const policy = vi.fn();
beforeEach(() => {
  vi.stubEnv('ENTITLEMENT_STORE', 'memory'); vi.stubEnv('ARKIV_ACCESS_KEY', '');
  vi.stubEnv('BILLING_STORE', 'memory');
  resetGrantStoreForTests(); vi.stubGlobal('fetch', policy); policy.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetGrantStoreForTests(); });
async function fixture(status = 'active') {
  policy.mockImplementation(async (url: string) => {
    if (url.includes('/v1/resolve')) return new Response(JSON.stringify({
      agent: { id: worker, status: 'active', operator_address: address },
      mandate: { id: 'mandate', status, owner_address: address, contract_address: address },
    }));
    if (url.endsWith('/v1/spend-intents')) return new Response(JSON.stringify({ error: { code: 'MANDATE_EMPTY', message: 'PerTxCapExceeded' } }), { status: 403 });
    throw new Error('Unexpected network call');
  });
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => { const r = errorResponse(error); return reply.code(r.status).send(r.body); });
  buildRoutes(app, { config: { ENTITLEMENT_STORE: 'memory', DAEMON_AUTH_TOKEN: 'test', DAEMON_OPERATOR_KEY: key, DAEMON_EXECUTOR_KEY: key }, redis: {}, db: {} } as unknown as ServiceDeps);
  return app;
}
function payment(app: Awaited<ReturnType<typeof fixture>>) {
  return app.inject({ method: 'POST', url: `/internal/workers/${worker}/fetch`,
    headers: { authorization: 'Bearer test' }, payload: { amount: '1', recipient: address } });
}
describe('new payments retain their spending gates', () => {
  it('rejects an unavailable mandate before consuming credits or attempting a payment', async () => {
    const app = await fixture('unavailable');
    try {
      const res = await payment(app); expect(res.statusCode).toBe(403); expect(res.json().error.code).toBe('WORKER_INACTIVE');
      expect(policy).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it('requires a living payment entitlement even when the worker is active', async () => {
    const app = await fixture();
    try {
      const res = await payment(app); expect(res.statusCode).toBe(403); expect(res.json().error.message).toContain('GRANT_EXPIRED');
      expect(policy).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it('still requests policy authorization and preserves credits when the USDT cap denies payment', async () => {
    const app = await fixture();
    const store = getGrantStore();
    const grant = await store.mint({ holder: address, feature: 'research_fetch', worker_id: worker, remaining: '2', ttl_seconds: 120 });
    try {
      const res = await payment(app);
      expect(res.statusCode).toBe(403); expect(res.json().error.code).toBe('MANDATE_EMPTY');
      expect(policy.mock.calls.some(([url]) => url.endsWith('/v1/spend-intents'))).toBe(true);
      expect((await store.get(grant.id))?.remaining).toBe('2');
    } finally { await app.close(); }
  });
});
