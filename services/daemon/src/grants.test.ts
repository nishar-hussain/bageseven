import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
import { registerGrantRoutes, type GrantRouteDeps } from './grants.js';

beforeEach(() => {
  vi.stubEnv('ENTITLEMENT_STORE', 'memory');
  vi.stubEnv('ARKIV_ACCESS_KEY', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('OPERATOR_NOTIFY_EMAIL', '');
  vi.stubEnv('BAGSEVEN_MCP_WORKER', '');
  vi.stubEnv('WORLD_CLIENT_ID', '');
  vi.stubEnv('WORLD_MOCK_PROOFS', 'true');
  vi.stubEnv('WORLD_AGENT_PASS_ENABLED', 'true');
  vi.stubEnv('HEDERA_X402_FACILITATOR_URL', '');
  vi.stubEnv('HEDERA_DEMO_SETTLE', 'true');
  resetGrantStoreForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetGrantStoreForTests(); });

async function fixture(deps: GrantRouteDeps = {}) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const result = errorResponse(error);
    return reply.code(result.status).send(result.body);
  });
  registerGrantRoutes(app, deps);
  await app.ready();
  const store = getGrantStore();
  const grant = await store.mint({ holder: 'local-test', feature: 'ocr', remaining: '3', ttl_seconds: 90, renewal_enabled: true, settlement_network: 'local' });
  return { app, store, grant };
}

describe('paid work dual gate', () => {
  it.each(['mint', 'buy-credits'])('binds dashboard %s grants to the configured worker and runs without a worker payload', async (route) => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const resolve = vi.fn(async () => ({ ok: true }));
    const { app, store } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const minted = await app.inject({ method: 'POST', url: `/internal/grants/${route}`, payload: {
        holder: 'dashboard-human', feature: 'ocr', remaining: '3', ttl_seconds: 90,
        world_proof_id: 'world:ok:dashboard-human',
      } });
      expect(minted.statusCode).toBe(200);
      const grant = minted.json().grant;
      expect(grant.worker_id).toBe('configured-worker');
      expect(await store.findLive({ worker_id: 'configured-worker' })).toEqual([expect.objectContaining({ id: grant.id })]);

      // The binding remains with the grant if the server default later changes.
      vi.stubEnv('BAGSEVEN_MCP_WORKER', 'different-worker');
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, amount: '1' } });
      expect(response.statusCode).toBe(200);
      expect(resolve).toHaveBeenCalledWith('configured-worker', '1');
      expect(response.json().grant.remaining).toBe('2');
      expect(response.json().dual_gate).toEqual({ mandate: 'ok', grant: 'ok' });
    } finally { await app.close(); }
  });

  it.each(['mint', 'buy-credits'])('preserves an explicit worker when binding a %s grant', async (route) => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const { app } = await fixture();
    try {
      const response = await app.inject({ method: 'POST', url: `/internal/grants/${route}`, payload: {
        holder: 'mcp-human', feature: 'ocr', remaining: '3', ttl_seconds: 90,
        world_proof_id: 'world:ok:mcp-human', worker_id: 'explicit-worker',
      } });
      expect(response.statusCode).toBe(200);
      expect(response.json().grant.worker_id).toBe('explicit-worker');
    } finally { await app.close(); }
  });

  it('uses the configured worker for an existing unbound grant', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', ' configured-worker ');
    const resolve = vi.fn(async () => ({ ok: true }));
    const { app, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      expect(grant.worker_id).toBeUndefined();
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id } });
      expect(response.statusCode).toBe(200);
      expect(resolve).toHaveBeenCalledWith('configured-worker', '1');
      expect(response.json().grant.remaining).toBe('2');
    } finally { await app.close(); }
  });

  it('checks an explicitly requested worker instead of silently using the default', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const resolve = vi.fn(async () => ({ ok: false, reason: 'worker unavailable' }));
    const { app, store, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'explicit-worker' } });
      expect(response.statusCode).toBe(403);
      expect(resolve).toHaveBeenCalledExactlyOnceWith('explicit-worker', '1');
      expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });

  it('preserves credits when the configured worker has insufficient mandate capacity', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const resolve = vi.fn(async () => ({ ok: false, reason: 'mandate unavailable' }));
    const { app, store, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, amount: '2' } });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('MANDATE_EMPTY');
      expect(resolve).toHaveBeenCalledWith('configured-worker', '2');
      expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });

  it('rejects a missing worker even when the request asks to skip the mandate gate', async () => {
    const { app, store, grant } = await fixture({ resolveMandateCapacity: async () => ({ ok: true }) });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, skip_mandate_gate: true } });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('MANDATE_REQUIRED');
      expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });

  it('fails closed when mandate resolution is unavailable', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const { app, grant } = await fixture();
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id } });
      expect(response.statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('checks the requested amount and preserves credits when mandate capacity is denied', async () => {
    const resolve = vi.fn(async () => ({ ok: false, reason: 'window exhausted' }));
    const { app, store, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'worker', amount: '2' } });
      expect(response.statusCode).toBe(403);
      expect(resolve).toHaveBeenCalledWith('worker', '2');
      expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });

  it('keeps current access after cancelling renewal and consumes only after both gates pass', async () => {
    const { app, store, grant } = await fixture({ resolveMandateCapacity: async () => ({ ok: true }) });
    try {
      await store.cancelRenewal(grant.id);
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'worker', amount: '1' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().grant).toMatchObject({ remaining: '2', renewal_enabled: false, paid_through: grant.paid_through });
    } finally { await app.close(); }
  });

  it('rejects paid work after paid_through and removes access from live queries', async () => {
    const { app, store, grant } = await fixture({ resolveMandateCapacity: async () => ({ ok: true }) });
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(grant.paid_through).getTime() + 1);
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'worker' } });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('GRANT_EXPIRED');
      expect(await store.findLive({ holder: 'local-test' })).toEqual([]);
    } finally { await app.close(); }
  });
});
