import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorResponse } from '@bagseven/server';
import { resetGrantStoreForTests } from '@bagseven/entitlements';
import { registerBillingRoutes } from './billing.js';
import { resetBillingStoreForTests } from './billing-store.js';

beforeEach(() => {
  vi.stubEnv('PROVIDER_FUNDED_GAS', 'false');
  vi.stubEnv('ENTITLEMENT_STORE', 'memory');
  vi.stubEnv('ARKIV_ACCESS_KEY', '');
  vi.stubEnv('WHITECHAIN_DEMO_SETTLE', 'true');
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
  it('isolates provider plans and checkouts and rejects a forged owner on creation', async () => {
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => {
      const result = errorResponse(error);
      return reply.code(result.status).send(result.body);
    });
    registerBillingRoutes(app);
    const alice = { authorization: 'Bearer sk_test_unit', 'x-bagseven-provider': 'world:alice' };
    const bob = { authorization: 'Bearer sk_test_unit', 'x-bagseven-provider': 'world:bob' };
    try {
      const created = await app.inject({ method: 'POST', url: '/v1/plans', headers: alice, payload: {
        name: 'Alice plan', feature: 'ocr', amount: '100', merchant_wallet: '0x3333333333333333333333333333333333333333', provider_id: 'world:bob',
      } });
      expect(created.statusCode).toBe(200);
      const plan = created.json().plan;
      expect(plan.provider_id).toBe('world:alice');
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
