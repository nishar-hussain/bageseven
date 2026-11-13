import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderApiKeys, type Database } from '@bagseven/db';
import { MemoryGrantStore } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
const grantStore = new MemoryGrantStore();
vi.mock('@bagseven/entitlements', async importOriginal => ({ ...await importOriginal<typeof import('@bagseven/entitlements')>(), getGrantStore: () => grantStore }));
import { registerPublicEntitlementRoutes } from './public-entitlements.js';
import { registerBillingRoutes, providerScope } from './billing.js';
import { authenticateApiRequest, issueEmbedToken } from './api-keys.js';
const fakeDb = {} as Database;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('isolates equal customer IDs across providers and rejects foreign grant mutations', async () => {
  vi.stubEnv('BAGSEVEN_SECRET_KEY', 'test-signing-secret');
  vi.spyOn(ProviderApiKeys.prototype, 'active').mockResolvedValue(true);
  const own = await grantStore.mint({ merchant: 'provider-a', holder: 'same-customer', feature: 'ocr', remaining: '3', ttl_seconds: 3600 });
  const foreign = await grantStore.mint({ merchant: 'provider-b', holder: 'same-customer', feature: 'ocr', remaining: '100', ttl_seconds: 3600 });
  const authority = { provider: 'provider-a', keyId: '11111111-1111-4111-8111-111111111111' };
  const token = issueEmbedToken('same-customer', process.env, 900, undefined, authority);
  const headers = { authorization: 'Bearer ' + token };
  const app = Fastify(); app.setErrorHandler((error, _req, reply) => { const result = errorResponse(error); return reply.code(result.status).send(result.body); });
  registerPublicEntitlementRoutes(app, { db: fakeDb });
  try {
    const check = await app.inject({ url: '/v1/check?feature=ocr', headers });
    expect(check.statusCode).toBe(200); expect(check.json().total_remaining).toBe('3');
    const list = await app.inject({ url: '/v1/entitlements', headers });
    expect(list.json().grants.map((g: { id: string }) => g.id)).toEqual([own.id]);
    const consume = await app.inject({ method: 'POST', url: '/v1/usage/consume', headers, payload: { feature: 'ocr', grant_id: foreign.id, amount: '1', idempotencyKey: 'foreign' } });
    expect(consume.statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/entitlements/' + foreign.id + '/cancel-renewal', headers })).statusCode).toBe(404);
    expect((await grantStore.get(foreign.id))?.remaining).toBe('100');
  } finally { await app.close(); }
});
it('cannot override a managed key provider through console-only headers', async () => {
  vi.spyOn(ProviderApiKeys.prototype, 'authenticate').mockResolvedValue({ id: 'key-id', kind: 'sk', provider_id: 'provider-a' } as Awaited<ReturnType<ProviderApiKeys['authenticate']>>);
  const req = { headers: { authorization: 'Bearer bgs_sk_test', 'x-bagseven-provider': 'provider-b' } };
  await authenticateApiRequest(req, fakeDb);
  expect(() => providerScope(req)).toThrow(/cannot be overridden/);
});
it('filters merchant plans for provider keys without inheriting legacy plans', async () => {
  vi.stubEnv('PROVIDER_GAS_MODE', 'disabled');
  vi.spyOn(ProviderApiKeys.prototype, 'authenticate').mockResolvedValue({ id: 'key-id', kind: 'pk', provider_id: 'provider-a' } as Awaited<ReturnType<ProviderApiKeys['authenticate']>>);
  const billing = await import('./billing-store.js'); billing.resetBillingStoreForTests();
  const store = billing.getBillingStore();
  for (const provider of ['provider-a','provider-b','legacy']) await store.createPlan({ provider_id: provider, feature: 'ocr', name: provider, amount: '1', merchant_wallet: '0x' + '11'.repeat(20) });
  const app = Fastify(); registerBillingRoutes(app, { db: fakeDb });
  try {
    const response = await app.inject({ url: '/v1/plans', headers: { authorization: 'Bearer bgs_pk_test' } });
    expect(response.statusCode).toBe(200); expect(response.json().plans.map((p: { provider_id: string }) => p.provider_id)).toEqual(['provider-a']);
  } finally { await app.close(); billing.resetBillingStoreForTests(); }
});
