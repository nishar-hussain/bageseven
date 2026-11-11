import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryGrantStore } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
import { registerSubscriptionRoutes } from './subscription-routes.js';
import { Subscriptions } from './subscriptions.js';
import { MemorySubscriptionStore } from './subscription-store.js';
import type { SubscriptionChain } from './subscription-chain.js';
import { PlanSchema } from './billing-store.js';
import { issueEmbedToken } from './api-keys.js';

beforeEach(() => {
  vi.stubEnv('DAEMON_AUTH_TOKEN', 'sk_test_subscription'); vi.stubEnv('BAGSEVEN_PUBLISHABLE_KEY', 'pk_test_subscription');
  vi.stubEnv('AUTH_SECRET', 'test-subscription-secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('subscription holder scope and cancellation', () => {
  it('keeps cancellation an unsigned wallet action and rejects other holders', async () => {
    const store = new MemorySubscriptionStore();
    const plan = PlanSchema.parse({ id: 'plan', provider_id: 'provider', feature: 'ocr', name: 'Pro', interval: 'month',
      amount: '1', credits: '5', ttl_seconds: 2592000, merchant_wallet: `0x${'11'.repeat(20)}`, created_at: new Date().toISOString() });
    await store.save({ id: 'sub_one', checkoutId: 'one', holder: 'alice', providerId: 'provider', plan, chainId: 1874,
      contract: `0x${'22'.repeat(20)}`, key: `0x${'33'.repeat(32)}`, payer: `0x${'44'.repeat(20)}`, status: 'ACTIVE',
      paidThrough: 1800000000, nextAttemptAt: 1800000120, failures: 0, grantId: 'grant', paymentTx: `0x${'55'.repeat(32)}` });
    const chain: SubscriptionChain = {
      preparePlan: async () => { throw Error('must not deploy'); }, verifyPlan: async () => false,
      broadcast: async () => { throw Error('must not broadcast'); }, signCharge: async () => { throw Error('must not charge'); },
      payment: async () => null, state: async () => ({ payer: `0x${'44'.repeat(20)}`, paidThrough: 1800000000, payments: 1, cancelled: false, balance: 0n, allowance: 0n }),
    };
    const app = Fastify(); app.setErrorHandler((error, _req, reply) => { const result = errorResponse(error); return reply.code(result.status).send(result.body); });
    registerSubscriptionRoutes(app, new Subscriptions(store, chain, new MemoryGrantStore()));
    const auth = (holder: string) => ({ authorization: `Bearer ${issueEmbedToken(holder, process.env)}` });
    try {
      expect((await app.inject({ url: '/v1/subscriptions', headers: { authorization: 'Bearer pk_test_subscription' } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/v1/subscriptions/sub_one', headers: auth('bob') })).statusCode).toBe(403);
      expect((await app.inject({ url: '/v1/subscriptions?holder=bob', headers: auth('alice') })).statusCode).toBe(403);
      const cancelled = await app.inject({ method: 'POST', url: '/v1/subscriptions/sub_one/cancel', headers: auth('alice') });
      expect(cancelled.statusCode).toBe(200); expect(cancelled.json().requires_wallet_approval).toBe(true);
      expect(cancelled.json().transaction.to).toBe(`0x${'22'.repeat(20)}`);
      expect((await store.get('sub_one'))?.status).toBe('ACTIVE');
      const listing = await app.inject({ url: '/v1/subscriptions', headers: auth('alice') });
      expect(listing.json().subscriptions).toHaveLength(1); expect(JSON.stringify(listing.json())).not.toContain('raw');
    } finally { await app.close(); }
  });
});
