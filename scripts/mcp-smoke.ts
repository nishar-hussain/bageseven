import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function parseResult(value: unknown): unknown {
  const text = (value as { content?: Array<{ type?: string; text?: string }> }).content?.find((item) => item.type === 'text')?.text;
  if (!text) return value;
  try { return JSON.parse(text); } catch { return text; }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} returned an MCP error: ${JSON.stringify(result)}`);
  return parseResult(result);
}

async function main(): Promise<void> {
  const url = process.env.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
  const transport = new StreamableHTTPClientTransport(new URL(url), process.env.MCP_AUTH_TOKEN ? { requestInit: { headers: { authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } } } : undefined);
  const client = new Client({ name: 'bagseven-local-smoke', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const status = await call(client, 'bagseven_status');
    console.log(JSON.stringify({ test: 'bagseven_status', result: status }, null, 2));
    const search = await call(client, 'bagseven_search', { query: process.env.MCP_SMOKE_QUERY ?? 'research' });
    console.log(JSON.stringify({ test: 'bagseven_search', result: search }, null, 2));

    const paidUrl = process.env.MCP_SMOKE_PAID_URL;
    if (!paidUrl) {
      console.log('No MCP_SMOKE_PAID_URL supplied; no payment was attempted.');
      return;
    }
    const payment = await call(client, 'bagseven_fetch', { url: paidUrl, reason: 'local MCP smoke test' });
    console.log(JSON.stringify({ test: 'bagseven_fetch', result: payment }, null, 2));

    if (process.env.MCP_SMOKE_REPEAT === 'true') {
      const repeated = await call(client, 'bagseven_fetch', { url: paidUrl, reason: 'local MCP duplicate-request test' });
      console.log(JSON.stringify({ test: 'bagseven_fetch_repeat', result: repeated }, null, 2));
    }
    const blockedUrl = process.env.MCP_SMOKE_BLOCKED_URL;
    if (blockedUrl) {
      try {
        const blocked = await call(client, 'bagseven_fetch', { url: blockedUrl, reason: 'local MCP denial test' });
        console.log(JSON.stringify({ test: 'bagseven_fetch_blocked', result: blocked }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ test: 'bagseven_fetch_blocked', error: (error as Error).message }, null, 2));
      }
    }
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`[mcp-smoke] ${(error as Error).message}`);
  process.exitCode = 1;
});
