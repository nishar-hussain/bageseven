import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorResponse } from '@bagseven/server';
import { EntitlementPreflightError, getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import type { Redis } from 'ioredis';
import { registerBillingRoutes } from './billing.js';
import { getBillingStore, resetBillingStoreForTests } from './billing-store.js';

beforeEach(() => {
  vi.stubEnv('PROVIDER_FUNDED_GAS', 'false');
  vi.stubEnv('ENTITLEMENT_STORE', 'memory');
  vi.stubEnv('REGISTRY_ACCESS_KEY', '');
  vi.stubEnv('AVALANCHE_DEMO_SETTLE', 'true');
  vi.stubEnv('DAEMON_AUTH_TOKEN', 'sk_test_unit');
  vi.stubEnv('BAGSEVEN_PUBLISHABLE_KEY', 'pk_test_unit');
  resetGrantStoreForTests();
  resetBillingStoreForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetGrantStoreForTests();
  resetBillingStoreForTests();
});

describe('billing plans + checkout', () => {
  it('recovers an issued grant after checkout persistence fails without minting again', async () => {
    const holds = new Map<string, string>();
    const redis = { set: async (k: string, v: string, nx?: string) => { if (nx && holds.has(k)) return null; holds.set(k, v); return 'OK'; },
      get: async (k: string) => holds.get(k), getdel: async (k: string) => { const v = holds.get(k); holds.delete(k); return v; } };
    const app = Fastify();
    registerBillingRoutes(app, { redis: redis as unknown as Redis });
    const store = getBillingStore();
    const plan = await store.createPlan({ name: 'Recovery', feature: 'ocr', amount: '1', merchant_wallet: `0x${'33'.repeat(20)}` });
    const session = await store.createCheckout({ plan_id: plan.id, holder: 'buyer' });
    vi.spyOn(store, 'markPaid').mockRejectedValueOnce(Error('database disconnected'));
    const mint = vi.spyOn(getGrantStore(), 'mint');
    const payload = { payment_tx: `0x${'af'.repeat(32)}`, customer_wallet: `0x${'22'.repeat(20)}` };
    try {
      expect((await app.inject({ method: 'POST', url: `/v1/public/checkout/${session.id}/confirm`, payload })).statusCode).toBe(500);
      expect((await getGrantStore().findLive({ holder: 'buyer' }))).toHaveLength(1);
      const retry = await app.inject({ method: 'POST', url: `/v1/public/checkout/${session.id}/confirm`, payload });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().session.status).toBe('PAID');
      expect(mint).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it.each([true, false])('retries only known pre-signing failures while preserving unknown payment holds (%s)', async safe => {
    const receipts = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string, nx?: string) => { if (nx === 'NX' && receipts.has(key)) return null; receipts.set(key, value); return 'OK'; }),
      get: vi.fn(async (key: string) => receipts.get(key) ?? null),
      getdel: vi.fn(async (key: string) => { const value = receipts.get(key); receipts.delete(key); return value ?? null; }),
    };
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => { const result = errorResponse(error); return reply.code(result.status).send(result.body); });
    registerBillingRoutes(app, { redis: redis as unknown as Redis });
    const mint = vi.spyOn(getGrantStore(), 'mint').mockRejectedValueOnce(safe ? new EntitlementPreflightError('str', 'long holder', 'exceeds 128 bytes') : new Error('Broadcast result unknown'));
    try {
      const plan = (await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: 'Bearer sk_test_unit' }, payload: { name: 'Retry checkout', feature: 'ocr', amount: '0.05', merchant_wallet: '0x3333333333333333333333333333333333333333' } })).json().plan;
      const create = async () => (await app.inject({ method: 'POST', url: '/v1/checkout-sessions', headers: { authorization: 'Bearer sk_test_unit' }, payload: { plan_id: plan.id, holder: 'human' } })).json().session;
      const session = await create();
      const body = { payment_tx: `0x${'ab'.repeat(32)}`, customer_wallet: '0x2222222222222222222222222222222222222222' };
      expect((await app.inject({ method: 'POST', url: `/v1/public/checkout/${session.id}/confirm`, payload: body })).statusCode).toBe(500);
      const other = await create();
      expect((await app.inject({ method: 'POST', url: `/v1/public/checkout/${other.id}/confirm`, payload: body })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `/v1/public/checkout/${session.id}/confirm`, payload: body })).statusCode).toBe(safe ? 200 : 409);
      expect(mint).toHaveBeenCalledTimes(safe ? 2 : 1);
    } finally { await app.close(); }
  });
  it('lets a customer check out without inheriting an unregistered default MCP agent', async () => {
    vi.stubEnv('BAGSEVEN_MCP_WORKER', 'unregistered-default-agent');
    const validateWorker = vi.fn(async () => { throw new ApiError(403, 'WORKER_INACTIVE', 'Agent not registered'); });
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => { const result = errorResponse(error); return reply.code(result.status).send(result.body); });
    registerBillingRoutes(app, { validateWorker });
    try {
      const plan = (await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: 'Bearer sk_test_unit' }, payload: { name: 'Human checkout', feature: 'ocr', amount: '0.05', merchant_wallet: '0x3333333333333333333333333333333333333333' } })).json().plan;
      const checkout = await app.inject({ method: 'POST', url: '/v1/checkout-sessions', headers: { authorization: 'Bearer sk_test_unit' }, payload: { plan_id: plan.id, holder: 'human' } });
      expect(checkout.statusCode).toBe(200);
      expect(checkout.json().session.worker_id).toBeUndefined();
      expect(validateWorker).not.toHaveBeenCalled();
      const explicit = await app.inject({ method: 'POST', url: '/v1/checkout-sessions', headers: { authorization: 'Bearer sk_test_unit' }, payload: { plan_id: plan.id, holder: 'human', worker_id: '11111111-1111-4111-8111-111111111111' } });
      expect(explicit.statusCode).toBe(403);
      expect(validateWorker).toHaveBeenCalledExactlyOnceWith('11111111-1111-4111-8111-111111111111');
    } finally { await app.close(); }
  });
  it('isolates provider plans and checkouts and rejects a forged owner on creation', async () => {
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => {
      const result = errorResponse(error);
      return reply.code(result.status).send(result.body);
    });
    registerBillingRoutes(app);
    const alice = { authorization: 'Bearer sk_test_unit', 'x-bagseven-provider': 'account:alice' };
    const bob = { authorization: 'Bearer sk_test_unit', 'x-bagseven-provider': 'account:bob' };
    try {
      const created = await app.inject({ method: 'POST', url: '/v1/plans', headers: alice, payload: {
        name: 'Alice plan', feature: 'ocr', amount: '100', merchant_wallet: '0x3333333333333333333333333333333333333333', provider_id: 'account:bob',
      } });
      expect(created.statusCode).toBe(200);
      const plan = created.json().plan;
      expect(plan.provider_id).toBe('account:alice');
      expect((await app.inject({ url: '/v1/plans', headers: bob })).json().plans).toHaveLength(0);
      expect((await app.inject({ url: `/v1/plans/${plan.id}`, headers: bob })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/v1/checkout-sessions', headers: bob, payload: { plan_id: plan.id, holder: 'buyer' } })).statusCode).toBe(404);
      const checkout = await app.inject({ method: 'POST', url: '/v1/checkout-sessions', headers: alice, payload: { plan_id: plan.id, holder: 'buyer' } });
      expect(checkout.statusCode).toBe(200);
      const id = checkout.json().session.id;
      expect((await app.inject({ url: `/v1/checkout-sessions/${id}`, headers: bob })).statusCode).toBe(404);
      expect((await app.inject({ url: '/v1/checkout-sessions', headers: bob })).json().sessions).toHaveLength(0);
      expect((await app.inject({ url: '/v1/checkout-sessions', headers: alice })).json().sessions).toHaveLength(1);
    } finally { await app.close(); }
  });

  it('creates a plan, opens a session, and confirms into a living grant', async () => {
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => {
      const result = errorResponse(error);
      return reply.code(result.status).send(result.body);
    });
    registerBillingRoutes(app);
    await app.ready();
    try {
      const planRes = await app.inject({
        method: 'POST',
        url: '/v1/plans',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: {
          feature: 'ocr',
          name: 'OCR Starter',
          amount: '5.00',
          credits: '3',
          ttl_seconds: 600,
          merchant_wallet: '0x1111111111111111111111111111111111111111',
        },
      });
      expect(planRes.statusCode).toBe(200);
      const planId = planRes.json().plan.id as string;

      const sessionRes = await app.inject({
        method: 'POST',
        url: '/v1/checkout-sessions',
        headers: { authorization: 'Bearer sk_test_unit' },
        payload: { plan_id: planId, holder: 'buyer@example.com' },
      });
      expect(sessionRes.statusCode).toBe(200);
      const cs = sessionRes.json().session.id as string;
      expect(cs.startsWith('cs_')).toBe(true);

      const publicGet = await app.inject({ method: 'GET', url: `/v1/public/checkout/${cs}` });
      expect(publicGet.statusCode).toBe(200);
      expect(publicGet.json().session.status).toBe('PENDING');

      const confirm = await app.inject({
        method: 'POST',
        url: `/v1/public/checkout/${cs}/confirm`,
        payload: {
          payment_tx: `0x${'ab'.repeat(32)}`,
          customer_wallet: '0x2222222222222222222222222222222222222222',
        },
      });
      expect(confirm.statusCode).toBe(200);
      expect(confirm.json().session.status).toBe('PAID');
      expect(confirm.json().grant.remaining).toBe('3');
      expect(confirm.json().grant.feature).toBe('ocr');
    } finally {
      await app.close();
    }
  });
});
