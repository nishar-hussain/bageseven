import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetGrantStoreForTests } from '@bagseven/entitlements';
import type { ServiceDeps } from '@bagseven/server';
import { buildRoutes } from './index.js';

afterEach(() => { vi.unstubAllEnvs(); resetGrantStoreForTests(); });
describe('daemon deployment health and authentication', () => {
  it('allows only the registered health route without a service token', async () => {
    vi.stubEnv('ENTITLEMENT_STORE', 'memory'); vi.stubEnv('REGISTRY_ACCESS_KEY', '');
    resetGrantStoreForTests();
    const app = Fastify();
    app.get('/healthz', async () => ({ ok: true }));
    app.get('/healthz/private', async () => ({ secret: true }));
    buildRoutes(app, { config: { DAEMON_AUTH_TOKEN: 'health-test-token', ENTITLEMENT_STORE: 'memory' }, db: {}, redis: {} } as unknown as ServiceDeps);
    try {
      expect((await app.inject('/healthz')).json()).toEqual({ ok: true });
      expect((await app.inject('/healthz?probe=railway')).statusCode).toBe(200);
      expect((await app.inject({ method: 'HEAD', url: '/healthz' })).statusCode).toBe(200);
      expect((await app.inject('/healthz/private')).statusCode).toBe(401);
      expect((await app.inject('/internal/mumbai/status')).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
