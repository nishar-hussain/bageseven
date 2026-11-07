import { expect, it } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

it('discovers tools and retries an optional payment with identical inputs and key', async () => {
  const payments: unknown[] = [];
  const server = new McpServer({ name: 'local-smoke-fixture', version: '1' });
  const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  server.registerTool('bagseven_status', { inputSchema: {} }, async () => text({ mode: 'entitlements_only' }));
  server.registerTool('grant_status', { inputSchema: { feature: z.string() } }, async () => text({ grants: [] }));
  server.registerTool('bagseven_fetch', { inputSchema: { url: z.string(), reason: z.string(), idempotency_key: z.string() } }, async input => {
    payments.push(input); return text({ decision: 'allow', tx_hash: 'fixture-only' });
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
  await server.connect(transport);
  const app = express(); app.use(express.json());
  app.all('/mcp', async (req, res) => { await transport.handleRequest(req, res, req.body); });
  const listener = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./mcp-smoke.ts', import.meta.url))], {
      env: { ...process.env, BAGSEVEN_MCP_URL: `http://127.0.0.1:${address.port}/mcp`, MCP_AUTH_TOKEN: '', MCP_SMOKE_PAID_URL: 'http://fixture.invalid/paid', MCP_SMOKE_REPEAT: 'true', MCP_SMOKE_BLOCKED_URL: '' },
    });
    expect(stdout).not.toContain('bagseven_search');
    expect(payments).toHaveLength(2);
    expect(payments[1]).toEqual(payments[0]);
    expect(payments[0]).toHaveProperty('idempotency_key');
  } finally {
    await server.close();
    listener.closeAllConnections();
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
}, 10000);
