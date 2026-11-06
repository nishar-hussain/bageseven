#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
const token = process.env.MCP_AUTH_TOKEN ?? '';
const grantId = process.argv[2];
if (!grantId) {
  console.error('usage: node scripts/mcp-paid-run-check.mjs <grant_id>');
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(
  new URL(url),
  token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined,
);
const client = new Client({ name: 'bagseven-paid-run-check', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);
const result = await client.callTool({
  name: 'paid_run',
  arguments: { grant_id: grantId, amount: '1', work: 'mcp paid_run check' },
});
console.log(JSON.stringify(result, null, 2));
await client.close().catch(() => undefined);
await transport.close().catch(() => undefined);
if (result.isError) process.exit(1);
