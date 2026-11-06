import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
import { registerGrantRoutes, type GrantRouteDeps } from './grants.js';
import { registerPublicEntitlementRoutes } from './public-entitlements.js';

beforeEach(() => {
  vi.stubEnv('ENTITLEMENT_STORE', 'memory');
  vi.stubEnv('ARKIV_ACCESS_KEY', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('OPERATOR_NOTIFY_EMAIL', '');
  vi.stubEnv('BAGSEVEN_MCP_WORKER', '');
  vi.stubEnv('WORLD_CLIENT_ID', '');
  vi.stubEnv('WORLD_MOCK_PROOFS', 'true');
  vi.stubEnv('WORLD_AGENT_PASS_ENABLED', 'true');
  vi.stubEnv('WHITECHAIN_DEMO_SETTLE', 'true');
  vi.stubEnv('WHITECHAIN_PRIVATE_KEY', '');
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
  it('cannot use a paid grant assigned to another worker', async () => {
    const { app, store } = await fixture({ resolveMandateCapacity: async () => ({ ok: true }) });
    try {
      const grant = await store.mint({ holder: 'owner', feature: 'ocr', remaining: '3', ttl_seconds: 300, worker_id: 'other-worker' });
      const res = await app.inject({ method: 'POST', url: '/internal/grants/paid-run', payload: { grant_id: grant.id, worker_id: 'own-worker', amount: '1' } });
      expect(res.statusCode).toBe(403); expect(res.json().error.code).toBe('GRANT_WORKER_MISMATCH'); expect((await store.get(grant.id))?.remaining).toBe('3');
    } finally { await app.close(); }
  });
  it('cannot mint unpaid local grants with live World verification enabled', async () => {
    const { app } = await fixture(); vi.stubEnv('WORLD_MOCK_PROOFS', 'false');
    try {
      const res = await app.inject({ method: 'POST', url: '/internal/grants/mint', payload: { holder: 'owner', feature: 'ocr', remaining: '3', ttl_seconds: 300, settlement_network: 'local' } });
      expect(res.statusCode).toBe(403); expect(res.json().error.code).toBe('LIVE_PAYMENT_REQUIRED');
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
        payload: { holder: 'sdk-human', feature: 'ocr', remaining: '4', ttl_seconds: 90, world_proof_id: 'world:ok:sdk-human', worker_id: 'w1' },
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
      expect(credits.json().settlement.settlement_network).toBe('whitechain');

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

describe('World IDKit challenge lifecycle', () => {
  async function idkitFixture() {
    vi.stubEnv('WORLD_APP_ID', 'app_test'); vi.stubEnv('WORLD_RP_ID', 'rp_test');
    vi.stubEnv('WORLD_RP_SIGNING_KEY', `0x${'01'.repeat(32)}`); vi.stubEnv('WORLD_SIGNER_ADDRESS', '');
    vi.stubEnv('WORLD_IDKIT_ACTION', 'bagseven-mint');
    vi.stubEnv('WORLD_IDKIT_LOGIN_ACTION', 'bagseven-login');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = init?.body ? (JSON.parse(init.body) as { action?: string }) : {};
        return new Response(
          JSON.stringify({ success: true, action: body.action, environment: 'production', nullifier: '0x123456' }),
        );
      }),
    );
    return fixture();
  }
  function proof(nonce: string, action = 'bagseven-login') {
    return {
      protocol_version: '4.0',
      nonce,
      action,
      responses: [{ identifier: 'proof_of_human', nullifier: '0x123456', proof: 'verified-by-portal-in-this-unit-test' }],
    };
  }
  it('uses action-free session challenges and binds returning proofs to the saved World session', async () => {
    const { app } = await idkitFixture();
    try {
      const signed = await app.inject({ method: 'POST', url: '/internal/world/rp-signature', payload: { purpose: 'session', existing_session_id: 'session_saved' } });
      expect(signed.json().action).toBeNull();
      const payload = { idkit_response: { protocol_version: '4.0', nonce: signed.json().nonce, session_id: 'session_saved', responses: [{ identifier: 'proof_of_human', session_nullifier: ['0x123456', 'action'], proof: [] }] } };
      const verified = await app.inject({ method: 'POST', url: '/internal/world/verify-idkit-session', payload });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({ human_id: 'world:session:session_saved', returning: true });
      expect((await app.inject({ method: 'POST', url: '/internal/world/verify-idkit-session', payload })).statusCode).toBe(403);
      const wrong = await app.inject({ method: 'POST', url: '/internal/world/rp-signature', payload: { purpose: 'session', existing_session_id: 'session_saved' } });
      payload.idkit_response.nonce = wrong.json().nonce; payload.idkit_response.session_id = 'session_attacker';
      expect((await app.inject({ method: 'POST', url: '/internal/world/verify-idkit-session', payload })).statusCode).toBe(403);
    } finally { await app.close(); vi.unstubAllGlobals(); }
  });
  it('rejects an unissued nonce before remote verification', async () => {
    const { app } = await idkitFixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/internal/world/verify-idkit', payload: { idkit_response: proof('unissued') } });
      expect(res.statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
    } finally { await app.close(); vi.unstubAllGlobals(); }
  });
  it('allows returning humans with fresh challenges, rejects replay, and preserves mint eligibility', async () => {
    const { app } = await idkitFixture();
    try {
      for (let login = 0; login < 2; login++) {
        const signed = await app.inject({ method: 'POST', url: '/internal/world/rp-signature', payload: { purpose: 'login' } });
        expect(signed.statusCode).toBe(200);
        const payload = { idkit_response: proof(signed.json().nonce) };
        expect((await app.inject({ method: 'POST', url: '/internal/world/verify-idkit', payload })).statusCode).toBe(200);
        expect((await app.inject({ method: 'POST', url: '/internal/world/verify-idkit', payload })).statusCode).toBe(403);
      }
      const signed = await app.inject({ method: 'POST', url: '/internal/world/rp-signature', payload: { purpose: 'mint' } });
      const minted = await app.inject({
        method: 'POST',
        url: '/internal/grants/mint',
        payload: {
          feature: 'ocr',
          holder: 'world:human',
          remaining: '3',
          ttl_seconds: 60,
          settlement_network: 'local',
          idkit_response: proof(signed.json().nonce, 'bagseven-mint'),
        },
      });
      expect(minted.statusCode).toBe(200);
    } finally { await app.close(); vi.unstubAllGlobals(); }
  });
});
