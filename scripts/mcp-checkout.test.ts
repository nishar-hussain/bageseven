import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './bagseven-mcp';

const worker = '00000000-0000-4000-8000-000000000001';
async function call(name: string, args: Record<string, unknown>, daemon: (method: string, path: string, body?: unknown) => Promise<unknown>) {
  const server = buildServer(worker, daemon);
  const client = new Client({ name: 'checkout-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ text: string }>;
    return { error: result.isError, data: result.isError ? content[0]?.text : JSON.parse(content[0]!.text) };
  } finally { await client.close(); await server.close(); }
}
function fixture(error = 'NOT_FOUND: no agent found') {
  return vi.fn(async (_method: string, path: string, _body?: unknown) => {
    if (path === '/v1/plans') return { plans: [{ id: 'plan_provider', active: true, feature: 'ocr' }] };
    if (path.endsWith('/status')) throw new Error(error);
    if (path === '/v1/checkout-sessions') return { session: { id: 'cs_real-flow' } };
    throw new Error(`Unexpected path ${path}`);
  });
}
describe('MCP provider checkout without a spending agent', () => {
  it('opens human wallet checkout without requiring a mandate', async () => {
    for (const name of ['mint_with_world', 'buy_credits', 'create_checkout_session']) {
      const daemon = fixture();
      const result = await call(name, { plan_id: 'plan_provider', holder: 'world:customer' }, daemon);
      expect(result.error).not.toBe(true);
      expect(result.data.checkout_url).toContain('/checkout?session=cs_real-flow');
      expect(daemon.mock.calls.find(args => args[1] === '/v1/checkout-sessions')?.[2]).toEqual({ plan_id: 'plan_provider', holder: 'world:customer' });
      expect(daemon.mock.calls.some(args => /grants\/(mint|buy-credits)/.test(args[1]))).toBe(false);
    }
  });
  it('asks for a customer holder when it cannot infer one from an agent', async () => {
    const daemon = fixture();
    const result = await call('mint_with_world', { plan_id: 'plan_provider' }, daemon);
    expect(result.data.requires_holder).toBe(true);
    expect(daemon.mock.calls.some(args => args[1] === '/v1/checkout-sessions')).toBe(false);
  });
  it('does not silently bypass an unavailable policy service', async () => {
    const daemon = fixture('POLICY_UNAVAILABLE');
    const result = await call('buy_credits', { plan_id: 'plan_provider', holder: 'world:customer' }, daemon);
    expect(result.error).toBe(true);
    expect(daemon.mock.calls.some(args => args[1] === '/v1/checkout-sessions')).toBe(false);
  });
});
