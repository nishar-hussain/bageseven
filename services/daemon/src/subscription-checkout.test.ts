import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
import { registerBillingRoutes } from './billing.js';
import { resetBillingStoreForTests } from './billing-store.js';
import { Subscriptions } from './subscriptions.js';
import { MemorySubscriptionStore } from './subscription-store.js';
import type { SubscriptionChain } from './subscription-chain.js';
vi.mock('./avalanche-payment.js', async original => ({ ...await original<typeof import('./avalanche-payment.js')>(),
  verifyPaymentAuthorization: vi.fn(async () => {}), verifyAvalanchePayment: vi.fn(async () => {}),
}));
const payer = `0x${'11'.repeat(20)}`; const hash = `0x${'22'.repeat(32)}`;
const now = 1800000000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now * 1000);
  vi.stubEnv('PROVIDER_FUNDED_GAS', 'false'); vi.stubEnv('ENTITLEMENT_STORE', 'memory');
  vi.stubEnv('DAEMON_AUTH_TOKEN', 'sk_subscription_test'); vi.stubEnv('AVALANCHE_DEMO_SETTLE', 'true');
  resetGrantStoreForTests(); resetBillingStoreForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetGrantStoreForTests(); resetBillingStoreForTests(); });

async function fixture(paidAt = now) {
  const store = new MemorySubscriptionStore();
  const chain: SubscriptionChain = {
    preparePlan: async plan => ({ id: plan.id, providerId: 'provider', contract: `0x${'33'.repeat(20)}`, chainId: 43113, status: 'preparing', hash, raw: '0xdeployment' }),
    verifyPlan: async () => true, broadcast: async () => {},
    signCharge: async () => { throw Error('No renewal due during checkout'); },
    payment: async () => ({ paidAt, paidThrough: now + 2592000, hash, payer, period: 1 }),
    state: async () => ({ paidThrough: now + 2592000, payments: 1, payer, cancelled: false, balance: 0n, allowance: 0n }),
  };
  const app = Fastify(); app.setErrorHandler((error, _req, reply) => { const e = errorResponse(error); return reply.code(e.status).send(e.body); });
  registerBillingRoutes(app, { subscriptions: new Subscriptions(store, chain, getGrantStore()) });
  const planResponse = await app.inject({ method: 'POST', url: '/v1/plans', headers: { authorization: 'Bearer sk_subscription_test', 'x-bagseven-provider': 'provider' },
    payload: { name: 'Monthly Pro', amount: '1', credits: '10', feature: 'ocr', interval: 'month', ttl_seconds: 600, merchant_wallet: `0x${'44'.repeat(20)}` } });
  expect(planResponse.statusCode).toBe(200); const plan = planResponse.json().plan;
  expect(plan.ttl_seconds).toBe(2592000);
  const sessionResponse = await app.inject({ method: 'POST', url: '/v1/checkout-sessions', headers: { authorization: 'Bearer sk_subscription_test' }, payload: { plan_id: plan.id, holder: 'customer', expires_in: 600 } });
  expect(sessionResponse.statusCode).toBe(200); const session = sessionResponse.json().session;
  const confirm = () => app.inject({ method: 'POST', url: `/v1/public/checkout/${session.id}/confirm`, payload: { payment_tx: hash, customer_wallet: payer, payment_signature: `0x${'55'.repeat(65)}` } });
  return { app, store, session, confirm };
}
describe('monthly checkout fulfillment', () => {
  it('exposes a deadline-bound subscription transaction and fulfills a payment only once', async () => {
    const { app, store, session, confirm } = await fixture();
    try {
      const resolve = await app.inject({ url: `/v1/public/checkout/${session.id}` });
      expect(resolve.json().session.subscription_plan.status).toBe('ready');
      expect(resolve.json().session.subscription_plan.subscribe_data).toHaveLength(138);
      const first = await confirm(); expect(first.statusCode).toBe(200); expect(first.json().grant.renewal_enabled).toBe(true);
      const retry = await confirm(); expect(retry.json().already_paid).toBe(true);
      expect(await getGrantStore().findLive({ holder: 'customer' })).toHaveLength(1);
      expect((await store.list('customer'))[0].status).toBe('ACTIVE');
    } finally { await app.close(); }
  });
  it('can confirm a timely payment after the checkout link has expired', async () => {
    const { app, confirm } = await fixture();
    try {
      vi.setSystemTime((now + 601) * 1000);
      const result = await confirm(); expect(result.statusCode).toBe(200); expect(result.json().session.status).toBe('PAID');
    } finally { await app.close(); }
  });
  it('refuses a payment made after checkout expiry without granting access', async () => {
    const { app, confirm } = await fixture(now + 601);
    try {
      vi.setSystemTime((now + 601) * 1000);
      const result = await confirm(); expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe('CHECKOUT_EXPIRED');
      expect(await getGrantStore().findLive({ holder: 'customer' })).toHaveLength(0);
    } finally { await app.close(); }
  });
});
