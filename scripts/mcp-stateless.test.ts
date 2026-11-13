import express from 'express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleStatelessMcp } from './bagseven-mcp';
let listener: Server, url: string, instances = 0;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.all('/mcp', (req, res) => {
    const server = new McpServer({ name: 'replica-test', version: '1' });
    instances++;
    server.registerTool('ping', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
    return handleStatelessMcp(req, res, server);
  });
  listener = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  url = `http://127.0.0.1:${(listener.address() as { port: number }).port}/mcp`;
});
afterAll(async () => { listener.closeAllConnections(); await new Promise<void>(r => listener.close(() => r())); });
it('supports initialization and repeated tool calls on a fresh server instance for every request', async () => {
  const client = new Client({ name: 'stateless-test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    expect((await client.listTools()).tools[0]?.name).toBe('ping');
    for (let i = 0; i < 3; i++) expect(JSON.stringify(await client.callTool({ name: 'ping', arguments: {} }))).toContain('pong');
    expect(instances).toBeGreaterThanOrEqual(5);
  } finally { await client.close(); }
});
