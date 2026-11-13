import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getGrantStore, resetGrantStoreForTests } from '@bagseven/entitlements';
import { errorResponse } from '@bagseven/server';
import { registerGrantRoutes } from './grants.js';
import { buildServer } from '../../../scripts/bagseven-mcp.ts';

afterEach(() => { vi.unstubAllEnvs(); resetGrantStoreForTests(); });
describe('MCP prepaid access through the daemon', () => {
  it('uses credits with no payment worker, replays once, and refuses exhausted access', async () => {
    vi.stubEnv('ENTITLEMENT_STORE', 'memory'); vi.stubEnv('REGISTRY_ACCESS_KEY', '');
    vi.stubEnv('NOTIFY_MODE', 'log'); vi.stubEnv('OPERATOR_NOTIFY_EMAIL', ''); vi.stubEnv('RESEND_API_KEY', '');
    resetGrantStoreForTests();
    const app = Fastify();
    app.setErrorHandler((error, _req, reply) => { const r = errorResponse(error); return reply.code(r.status).send(r.body); });
    const capacity = vi.fn(async () => ({ ok: false, reason: 'no deployed mandate' }));
    registerGrantRoutes(app, { resolveMandateCapacity: capacity });
    const store = getGrantStore();
    const grant = await store.mint({ holder: 'integration-owner', feature: 'ocr', remaining: '2', ttl_seconds: 120, worker_id: 'access-agent' });
    const server = buildServer('access-agent', async (method, path, body) => {
      const res = await app.inject({ method: method as 'GET' | 'POST', url: path, payload: body });
      const data = res.json(); if (res.statusCode >= 400) throw new Error(`${data.error.code}: ${data.error.message}`);
      return data;
    });
    const client = new Client({ name: 'prepaid-integration', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left); await client.connect(right);
    const call = (idempotency_key: string) => client.callTool({ name: 'paid_run', arguments: { grant_id: grant.id, amount: '1', idempotency_key } });
    try {
      const first = await call('credit-use-1');
      expect(first.isError).not.toBe(true);
      expect(JSON.stringify(first)).toContain('not_required');
      await call('credit-use-1');
      expect((await store.get(grant.id))?.remaining).toBe('1');
      await store.cancelRenewal(grant.id);
      expect((await call('credit-use-2')).isError).not.toBe(true);
      expect((await store.get(grant.id))?.remaining).toBe('0');
      expect((await call('credit-use-2')).isError).not.toBe(true);
      expect((await store.get(grant.id))?.remaining).toBe('0');
      expect((await call('credit-use-3')).isError).toBe(true);
      expect(capacity).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); await app.close(); }
  });
});
