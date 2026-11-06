#!/usr/bin/env node
// Exercises the local product over HTTP and MCP, using only local tokens/mocks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(new URL('../.env', import.meta.url));
const cfg = process.env;
const consoleUrl = cfg.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3000';
const daemonUrl = cfg.DAEMON_URL || 'http://localhost:4001';
const holder = `e2e-${randomUUID()}`;
let cookie;

async function request(base, path, { method = 'GET', body, auth = false, status = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(base === consoleUrl && cookie ? { cookie } : {}),
      ...(auth ? { authorization: `Bearer ${cfg.DAEMON_AUTH_TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, got ${response.status}`);
  return response;
}
async function bff(path, body, status = 200) {
  return (await request(consoleUrl, `/api/daemon/${path}`, { method: body ? 'POST' : 'GET', body, status })).json();
}
async function tool(client, name, args = {}, error = false) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(Boolean(result.isError), error, `${name}: ${JSON.stringify(result)}`);
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (error) return text;
  return JSON.parse(text);
}

async function main() {
  assert.equal(cfg.DEV_MODE, 'true', 'E2E smoke requires local development mode');
  assert.equal(cfg.ENTITLEMENT_STORE, 'memory');
  assert.equal(cfg.WORLD_MOCK_PROOFS, 'true');
  assert.equal(cfg.WHITECHAIN_DEMO_SETTLE, 'true');
  assert.ok(!cfg.RESEND_API_KEY || cfg.NOTIFY_MODE === 'log', 'Start the stack and this check with NOTIFY_MODE=log to test without sending email');
  assert.ok(cfg.BAGSEVEN_MCP_WORKER, 'Run pnpm run setup first');
  for (const url of [consoleUrl, daemonUrl, cfg.POLICY_URL, cfg.NEXT_PUBLIC_GATEWAY_URL, cfg.NEXT_PUBLIC_LANDING_URL, cfg.RPC_URL]) {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'E2E smoke requires local endpoints');
  }

  const landing = await request(cfg.NEXT_PUBLIC_LANDING_URL, '/');
  assert.match(await landing.text(), /Bagseven/i);
  for (const url of [cfg.NEXT_PUBLIC_GATEWAY_URL, cfg.POLICY_URL, daemonUrl]) {
    const health = await request(url, '/healthz', { auth: url === daemonUrl });
    assert.equal((await health.json()).ok, true);
  }
  const status = await (await request(daemonUrl, '/internal/mumbai/status', { auth: true })).json();
  assert.equal(status.notifications.delivery, 'log', 'Restart the stack with NOTIFY_MODE=log before running E2E');
  await request(consoleUrl, '/app', { status: 307 });
  await request(consoleUrl, '/api/daemon/mumbai/status', { status: 401 });
  await request(daemonUrl, '/internal/mumbai/status', { status: 401 });
  console.log('PASS landing, service health, authentication boundaries');

  const email = cfg.AUTH_ALLOWLIST?.split(',')[0]?.trim() || 'e2e@bagseven.local';
  const magic = await (await request(consoleUrl, '/api/auth/magic', { method: 'POST', body: { email } })).json();
  assert.ok(magic.dev_hint, 'Local magic link missing');
  const callback = await request(consoleUrl, `${new URL(magic.dev_hint).pathname}${new URL(magic.dev_hint).search}`, { status: 307 });
  const setCookie = callback.headers.get('set-cookie');
  assert.match(setCookie, /bagseven_session=/);
  assert.match(setCookie, /HttpOnly/i);
  cookie = setCookie.split(';')[0];
  for (const page of ['', '/mint', '/credits', '/grants', '/mandate', '/mcp', '/attention', '/settings']) {
    assert.match(await (await request(consoleUrl, `/app${page}`)).text(), /Bagseven/i);
  }
  assert.equal((await bff('mumbai/status')).dual_gate.require_grant, true);
  console.log('PASS magic-link redirect cookie and all dashboard routes');

  const mintBody = { feature: 'ocr', holder, worker_id: cfg.BAGSEVEN_MCP_WORKER, remaining: '20', ttl_seconds: 120, world_proof_id: `world:ok:${holder}`, renewal_enabled: true };
  const mint = await bff('grants/mint', mintBody);
  assert.equal(mint.world.mode, 'mock');
  await bff('grants/mint', { ...mintBody, holder: `${holder}-denied`, world_proof_id: 'world:cancel:e2e' }, 403);
  assert.equal((await bff(`grants/live?holder=${holder}-denied`)).grants.length, 0);
  const bought = await bff('grants/buy-credits', { ...mintBody, holder: `${holder}-buyer`, amount: '1.00' });
  assert.equal(bought.settlement.mode, 'demo');
  assert.ok(bought.grant.payment_tx);
  console.log('PASS World mint/denial and Whitechain demo credits through dashboard proxy');

  const client = new Client({ name: 'bagseven-e2e', version: '0.1.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'scripts/bagseven-mcp.ts'], cwd: root, env: { ...cfg, BAGSEVEN_MCP_PORT: '', MCP_HTTP_PORT: '' }, stderr: 'inherit' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((entry) => entry.name);
    for (const name of ['bagseven_status', 'grant_status', 'check_entitlement', 'consume_entitlement', 'mint_with_world', 'buy_credits', 'create_checkout_session', 'paid_run', 'cancel_renewal', 'explain_denial', 'bagseven_fetch']) assert.ok(tools.includes(name));
    const worker = await tool(client, 'bagseven_status');
    assert.equal(worker.agent.id, cfg.BAGSEVEN_MCP_WORKER);
    assert.ok(Number(worker.remaining.can_draw) > 0);
    const minted = await tool(client, 'mint_with_world', { ...mintBody, holder: `${holder}-mcp`, remaining: '20' });
    const paid = await tool(client, 'paid_run', { grant_id: minted.grant.id, amount: '1', work: 'e2e' });
    assert.equal(paid.grant.remaining, '19');
    assert.deepEqual(paid.dual_gate, { mandate: 'ok', grant: 'ok' });
    const denial = await tool(client, 'paid_run', { grant_id: minted.grant.id, amount: '11' }, true);
    assert.match(denial, /MANDATE_EMPTY/);
    const cancel = await tool(client, 'cancel_renewal', { grant_id: minted.grant.id });
    assert.equal(cancel.grant.renewal_enabled, false);
    assert.equal(cancel.grant.paid_through, minted.grant.paid_through);
    assert.equal((await tool(client, 'paid_run', { grant_id: minted.grant.id })).grant.remaining, '18');
    assert.ok((await tool(client, 'grant_status', { holder: `${holder}-mcp` })).grants.some((grant) => grant.id === minted.grant.id));
    const credit = await tool(client, 'buy_credits', { holder: `${holder}-mcp-buy`, world_proof_id: 'world:ok:e2e-buyer' });
    assert.equal(credit.settlement.mode, 'demo');
    const fetchResult = await tool(client, 'bagseven_fetch', { amount: '0.10', recipient: worker.mandate.owner_address, reason: 'local e2e settlement' });
    assert.equal(fetchResult.decision, 'allow');
    assert.match(fetchResult.tx_hash, /^0x[0-9a-f]{64}$/i);
    console.log('PASS MCP worker, both gates, mandate denial, cancellation and on-chain local payment');

    const expiring = await tool(client, 'mint_with_world', { holder: `${holder}-expiry`, world_proof_id: 'world:ok:e2e-expiry', ttl_seconds: 1 });
    await sleep(Math.max(0, new Date(expiring.grant.paid_through).getTime() - Date.now()) + 100);
    assert.equal((await tool(client, 'grant_status', { holder: `${holder}-expiry` })).grants.length, 0);
    assert.match(await tool(client, 'paid_run', { grant_id: expiring.grant.id }, true), /GRANT_EXPIRED/);
    assert.equal((await tool(client, 'explain_denial', { grant_id: expiring.grant.id })).denied, true);
    console.log('PASS paid_through expiry removes access and refuses work');
  } finally {
    await client.close();
    await transport.close();
  }
  const logout = await request(consoleUrl, '/api/auth/logout', { method: 'POST', status: 303 });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  cookie = undefined;
  await request(consoleUrl, '/api/daemon/grants/live', { status: 401 });
  console.log('E2E_OK');
}

main().catch((error) => { console.error('E2E_FAIL', error.message); process.exitCode = 1; });
