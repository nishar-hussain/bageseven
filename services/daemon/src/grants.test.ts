import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
import { registerGrantRoutes, type GrantRouteDeps } from './grants.js';
import { registerPublicEntitlementRoutes } from './public-entitlements.js';

beforeEach(() => {
  vi.stubEnv('PROVIDER_FUNDED_GAS', 'false');
  vi.stubEnv('ENTITLEMENT_STORE', 'memory');
  vi.stubEnv('REGISTRY_ACCESS_KEY', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('OPERATOR_NOTIFY_EMAIL', '');
  vi.stubEnv('BAGSEVEN_MCP_WORKER', '');
  vi.stubEnv('AVALANCHE_DEMO_SETTLE', 'true');
  vi.stubEnv('AVALANCHE_PRIVATE_KEY', '');
  vi.stubEnv('DAEMON_AUTH_TOKEN', 'sk_test_unit');
  vi.stubEnv('BAGSEVEN_PUBLISHABLE_KEY', 'pk_test_unit');
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

describe('live payment and worker binding', () => {
  it('rejects legacy purchases before parsing proofs or attempting platform settlement in provider mode', async () => {
    const { app, store } = await fixture();
    vi.stubEnv('PROVIDER_FUNDED_GAS', 'true');
    try {
      for (const path of ['mint', 'buy-credits']) {
        const result = await app.inject({ method: 'POST', url: `/internal/grants/${path}`, payload: {} });
        expect(result.statusCode).toBe(409);
        expect(result.json().error.code).toBe('PROVIDER_CHECKOUT_REQUIRED');
      }
      expect(await store.findLive({ holder: 'new-customer' })).toHaveLength(0);
    } finally { await app.close(); }
  });
  it('cannot use a paid grant assigned to another worker', async () => {
    const { app, store } = await fixture({ resolveMandateCapacity: async () => ({ ok: true }) });
    try {
      const grant = await store.mint({ holder: 'owner', feature: 'ocr', remaining: '3', ttl_seconds: 300, worker_id: 'other-worker' });
      const res = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'own-worker', amount: '1' } });
      expect(res.statusCode).toBe(403); expect(res.json().error.code).toBe('GRANT_WORKER_MISMATCH'); expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });
  it('cannot mint unpaid local grants in production', async () => {
    const { app } = await fixture(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PROVIDER_FUNDED_GAS', 'true');
    try {
      const res = await app.inject({ method: 'POST', url: '/internal/grants/mint', payload: { holder: 'owner', feature: 'ocr', remaining: '3', ttl_seconds: 300, settlement_network: 'local' } });
      expect(res.statusCode).toBe(409); expect(res.json().error.code).toBe('PROVIDER_CHECKOUT_REQUIRED');
    } finally { await app.close(); }
  });
});

describe('prepaid access without a spending mandate', () => {
  it('auto-selects an unbound paid grant for the authenticated holder without a payment worker', async () => {
    const capacity = vi.fn();
    const { app, store } = await fixture({ resolveMandateCapacity: capacity });
    try {
      await store.mint({ holder: 'another-holder', feature: 'ocr', remaining: '999', ttl_seconds: 120 });
      const mine = await store.mint({ holder: 'my-holder', feature: 'ocr', remaining: '2', ttl_seconds: 120 });
      const res = await app.inject({ method: 'POST', url: '/internal/grants/paid-run',
        headers: { 'x-bagseven-actor': 'my-holder' }, payload: { feature: 'ocr', worker_id: 'unregistered-agent', amount: '1' } });
      expect(res.statusCode).toBe(200); expect(res.json().grant).toMatchObject({ id: mine.id, remaining: '1' });
      expect(capacity).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('rejects another feature even when the caller supplies a valid grant id', async () => {
    const { app, store, grant } = await fixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, feature: 'research_fetch' } });
      expect(res.statusCode).toBe(403); expect(res.json().error.code).toBe('FEATURE_MISMATCH');
      expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });
  it.each(['mint', 'buy-credits'])('binds dashboard %s grants to the configured worker and runs without a worker payload', async (route) => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const resolve = vi.fn(async () => ({ ok: true }));
    const { app, store } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const minted = await app.inject({ method: 'POST', url: `/internal/grants/${route}`, payload: {
        holder: 'dashboard-human', feature: 'ocr', remaining: '3', ttl_seconds: 90,

      } });
      expect(minted.statusCode).toBe(200);
      const grant = minted.json().grant;
      expect(grant.worker_id).toBe('configured-worker');
      expect(await store.findLive({ worker_id: 'configured-worker' })).toEqual([expect.objectContaining({ id: grant.id })]);

      // The binding remains with the grant if the server default later changes.
      vi.stubEnv('BAGSEVEN_MCP_WORKER', 'different-worker');
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, amount: '1' } });
      expect(response.statusCode).toBe(200);
      expect(resolve).not.toHaveBeenCalled();
      expect(response.json().grant.remaining).toBe('2');
      expect(response.json().dual_gate).toEqual({ mandate: 'not_required', grant: 'ok' });
    } finally { await app.close(); }
  });

  it.each(['mint', 'buy-credits'])('preserves an explicit worker when binding a %s grant', async (route) => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const { app } = await fixture();
    try {
      const response = await app.inject({ method: 'POST', url: `/internal/grants/${route}`, payload: {
        holder: 'mcp-human', feature: 'ocr', remaining: '3', ttl_seconds: 90,
        worker_id: 'explicit-worker',
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
      expect(resolve).not.toHaveBeenCalled();
      expect(response.json().grant.remaining).toBe('2');
    } finally { await app.close(); }
  });

  it('uses prepaid credits without resolving the requested worker spending budget', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const resolve = vi.fn(async () => ({ ok: false, reason: 'worker unavailable' }));
    const { app, store, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'explicit-worker' } });
      expect(response.statusCode).toBe(200);
      expect(resolve).not.toHaveBeenCalled();
      expect((await store.get(grant.id))?.remaining).toBe(response.json().grant.remaining);
      expect(Number(response.json().grant.remaining)).toBeLessThan(3);
    } finally { await app.close(); }
  });

  it('allows prepaid access when the configured worker has no mandate capacity', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const resolve = vi.fn(async () => ({ ok: false, reason: 'mandate unavailable' }));
    const { app, store, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, amount: '2' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().dual_gate.mandate).toBe('not_required');
      expect(resolve).not.toHaveBeenCalled();
      expect((await store.get(grant.id))?.remaining).toBe(response.json().grant.remaining);
      expect(Number(response.json().grant.remaining)).toBeLessThan(3);
    } finally { await app.close(); }
  });

  it('allows prepaid access without a registered payment worker', async () => {
    const { app, store, grant } = await fixture({ resolveMandateCapacity: async () => ({ ok: true }) });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, skip_mandate_gate: true } });
      expect(response.statusCode).toBe(200);
      expect(response.json().dual_gate.mandate).toBe('not_required');
      expect((await store.get(grant.id))?.remaining).toBe(response.json().grant.remaining);
      expect(Number(response.json().grant.remaining)).toBeLessThan(3);
    } finally { await app.close(); }
  });

  it('uses prepaid access when mandate resolution is unavailable', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'configured-worker');
    const { app, grant } = await fixture();
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id } });
      expect(response.statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it('treats amount as credits rather than a USDT spending limit', async () => {
    const resolve = vi.fn(async () => ({ ok: false, reason: 'window exhausted' }));
    const { app, store, grant } = await fixture({ resolveMandateCapacity: resolve });
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'worker', amount: '2' } });
      expect(response.statusCode).toBe(200);
      expect(resolve).not.toHaveBeenCalled();
      expect((await store.get(grant.id))?.remaining).toBe(response.json().grant.remaining);
      expect(Number(response.json().grant.remaining)).toBeLessThan(3);
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

  it('reports total holder credits when consumption changes the richest grant', async () => {
    const app = Fastify();
    registerPublicEntitlementRoutes(app);
    await app.ready();
    const store = getGrantStore();
    try {
      const one = await store.mint({ holder: 'multiple-packs', feature: 'ocr', remaining: '44', ttl_seconds: 120 });
      await store.mint({ holder: 'multiple-packs', feature: 'ocr', remaining: '44', ttl_seconds: 120 });
      const headers = { authorization: 'Bearer sk_test_unit' };
      const check = () => app.inject({ url: '/v1/check?feature=ocr&holder=multiple-packs', headers });
      expect((await check()).json().total_remaining).toBe('88');
      await store.consume(one.id, '1', 'multi-pack-use');
      const result = (await check()).json();
      expect(result.remaining).toBe('44');
      expect(result.total_remaining).toBe('87');
      expect(result.grant_id).not.toBe(one.id);
    } finally { await app.close(); }
  });

  it('exposes Schematic-style /v1/check and consume for humans vs agents', async () => {
    const resolve = vi.fn(async () => ({ ok: true }));
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const result = errorResponse(error);
      return reply.code(result.status).send(result.body);
    });
    registerGrantRoutes(app, { resolveMandateCapacity: resolve });
    registerPublicEntitlementRoutes(app, { resolveMandateCapacity: resolve });
    await app.ready();
    try {
      const minted = await app.inject({
        method: 'POST',
        url: '/internal/grants/mint',
        payload: { holder: 'sdk-human', feature: 'ocr', remaining: '4', ttl_seconds: 90, worker_id: 'w1' },
      });
      expect(minted.statusCode).toBe(200);

      const check = await app.inject({
        method: 'GET',
        url: '/v1/check?feature=ocr&holder=sdk-human',
        headers: { authorization: 'Bearer pk_test_unit' },
      });
      expect(check.statusCode).toBe(200);
      expect(check.json().enabled).toBe(true);
      expect(check.json().remaining).toBe('4');

      const pkConsume = await app.inject({
        method: 'POST',
        url: '/v1/usage/consume',
        headers: { authorization: 'Bearer pk_test_unit' },
        payload: { feature: 'ocr', holder: 'sdk-human', amount: '1', idempotencyKey: 'pk-1' },
      });
      expect(pkConsume.statusCode).toBe(403);

      const missingKey = await app.inject({
        method: 'POST',
        url: '/v1/usage/consume',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: { feature: 'ocr', holder: 'sdk-human', amount: '1' },
      });
      expect(missingKey.statusCode).toBe(400);

      const token = await app.inject({
        method: 'POST',
        url: '/v1/access-tokens',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: { holder: 'sdk-human' },
      });
      expect(token.statusCode).toBe(200);
      const embed = token.json().token as string;

      const humanConsume = await app.inject({
        method: 'POST',
        url: '/v1/usage/consume',
        headers: { authorization: `Bearer ${embed}` },
        payload: { feature: 'ocr', amount: '1', idempotencyKey: 'human-1' },
      });
      expect(humanConsume.statusCode).toBe(200);
      expect(humanConsume.json().dual_gate.mandate).toBe('not_required');
      expect(humanConsume.json().entitlement.remaining).toBe('3');

      const agentConsume = await app.inject({
        method: 'POST',
        url: '/v1/usage/consume',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: { feature: 'ocr', holder: 'sdk-human', amount: '1', idempotencyKey: 'agent-1' },
      });
      expect(agentConsume.statusCode).toBe(200);
      expect(resolve).not.toHaveBeenCalled();
      expect(agentConsume.json().dual_gate).toEqual({ mandate: 'not_required', grant: 'ok' });

      const credits = await app.inject({
        method: 'POST',
        url: '/v1/credits',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: { feature: 'ocr', holder: 'sdk-human', remaining: '5', amount: '1.00' },
      });
      expect(credits.statusCode).toBe(200);
      expect(credits.json().grant.remaining).toBe('5');
      expect(credits.json().settlement.settlement_network).toBe('avalanche');

      const noGrant = await app.inject({
        method: 'POST',
        url: '/v1/credits',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: { feature: 'ocr', holder: 'nobody@bagseven.local', remaining: '5' },
      });
      expect(noGrant.statusCode).toBe(404);
    } finally {
      await app.close();
    }
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
