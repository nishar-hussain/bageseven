#!/usr/bin/env node
// Isolated local product verification. Never run against public RPCs or live credentials.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BagsevenClient, BagsevenApiError } from '../packages/sdk/dist/node.js';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(new URL('../.env', import.meta.url));
const cfg = process.env;
const consoleUrl = cfg.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3000';
const daemonUrl = cfg.DAEMON_URL || 'http://localhost:4001';
let cookie;
async function request(base, path, { method = 'GET', body, auth = false, status = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(base === consoleUrl && cookie ? { cookie } : {}),
      ...(auth ? { authorization: `Bearer ${cfg.DAEMON_AUTH_TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, got ${response.status}: ${response.status === status ? '' : (await response.text()).slice(0, 600)}`);
  return response;
}
const bff = async (path, body, status = 200) => (await request(consoleUrl, `/api/daemon/${path}`, { method: body ? 'POST' : 'GET', body, status })).json();
async function connect(worker = cfg.BAGSEVEN_MCP_WORKER) {
  const client = new Client({ name: 'bagseven-local-e2e', version: '1' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'scripts/bagseven-mcp.ts'], cwd: root,
    env: { ...cfg, PORT: '', BAGSEVEN_MCP_WORKER: worker, BAGSEVEN_MCP_PORT: '', MCP_HTTP_PORT: '' }, stderr: 'inherit' });
  await client.connect(transport);
  return { client, transport };
}
async function tool(client, name, args = {}, error = false) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(Boolean(result.isError), error, `${name}: ${JSON.stringify(result)}`);
  const text = result.content?.find(item => item.type === 'text')?.text;
  return error ? text : JSON.parse(text);
}
async function mint(holder, feature = 'ocr', options = {}) {
  return bff('grants/mint', { feature, holder, worker_id: cfg.BAGSEVEN_MCP_WORKER, remaining: '20', ttl_seconds: 600,
    world_proof_id: `world:ok:${randomUUID()}`, renewal_enabled: true, ...options });
}
async function main() {
  assert.equal(cfg.NODE_ENV ?? 'development', 'development', 'E2E smoke requires a development stack');
  assert.equal(cfg.DEV_MODE, 'true');
  assert.equal(cfg.ENTITLEMENT_STORE, 'memory');
  assert.equal(cfg.WORLD_MOCK_PROOFS, 'true');
  assert.equal(cfg.WHITECHAIN_DEMO_SETTLE, 'true');
  assert.equal(cfg.NOTIFY_MODE, 'log', 'Both stack and smoke must suppress email');
  assert.ok(!cfg.RESEND_API_KEY && !cfg.ARKIV_ACCESS_KEY && !cfg.WHITECHAIN_PRIVATE_KEY, 'Use an isolated local fixture without live credentials');
  assert.ok(cfg.BAGSEVEN_MCP_WORKER, 'Run local setup first');
  for (const url of [consoleUrl, daemonUrl, cfg.POLICY_URL, cfg.NEXT_PUBLIC_GATEWAY_URL, cfg.NEXT_PUBLIC_LANDING_URL, cfg.RPC_URL, cfg.WHITECHAIN_RPC_URL]) {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'E2E smoke requires local endpoints');
  }
  const rpc = await fetch(cfg.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'web3_clientVersion', params: [] }) });
  assert.match((await rpc.json()).result, /anvil/i, 'Payments must stay on local Anvil');
  assert.match(await (await request(cfg.NEXT_PUBLIC_LANDING_URL, '/')).text(), /Bagseven/i);
  for (const path of ['/docs', '/docs/introduction', '/docs/quickstart', '/docs/sdk/node', '/docs/guides/mcp', '/llms.txt']) {
    const response = await request(cfg.NEXT_PUBLIC_LANDING_URL, path, { status: path === '/docs' ? 307 : 200 });
    if (path !== '/docs') assert.match(await response.text(), /Bagseven/i);
  }
  for (const url of [cfg.NEXT_PUBLIC_GATEWAY_URL, cfg.POLICY_URL, daemonUrl]) assert.equal((await (await request(url, '/healthz')).json()).ok, true);
  await request(consoleUrl, '/app', { status: 307 });
  await request(consoleUrl, '/api/daemon/mumbai/status', { status: 401 });
  await request(daemonUrl, '/internal/mumbai/status', { status: 401 });
  console.log('PASS landing/docs, service health and authentication boundaries');

  const magic = await (await request(consoleUrl, '/api/auth/magic', { method: 'POST', body: { email: `e2e-${randomUUID()}@bagseven.local` } })).json();
  assert.ok(magic.dev_hint);
  const callbackUrl = new URL(magic.dev_hint);
  const recovery = await request(consoleUrl, callbackUrl.pathname + callbackUrl.search, { status: 307 });
  assert.match(recovery.headers.get('set-cookie'), /bagseven_session=.*HttpOnly/i);
  const login = await request(consoleUrl, '/api/auth/world', { method: 'POST', body: { mock: true } });
  cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('bagseven_session='));
  const me = await (await request(consoleUrl, '/api/me')).json();
  const holder = me.holder;
  assert.ok(holder && me.mock);
  for (const page of ['', '/mint', '/credits', '/grants', '/mandate', '/mcp', '/attention', '/settings', '/account', '/developers', '/plans', '/builder']) {
    assert.match(await (await request(consoleUrl, `/app${page}`)).text(), /Bagseven/i);
  }
  const checkoutsRedirect = await request(consoleUrl, '/app/checkouts', { status: 307 });
  assert.equal(new URL(checkoutsRedirect.headers.get('location'), consoleUrl).pathname, '/app/builder');
  assert.equal((await bff('mumbai/status')).notifications.delivery, 'log');
  const minted = await mint(holder);
  assert.equal(minted.world.mode, 'mock');
  const before = (await bff('grants/live')).grants.length;
  await mint(holder, 'ocr', { world_proof_id: 'world:cancel:e2e' }).then(() => assert.fail('Denied World mint unexpectedly succeeded'), error => assert.match(error.message, /403/));
  assert.equal((await bff('grants/live')).grants.length, before);
  await bff('grants/paid-run', { grant_id: minted.grant.id, amount: '1', idempotency_key: 'bff-e2e-1' });
  console.log('PASS World-primary login, email recovery, dashboard BFF and denied consent');

  const sdk = new BagsevenClient({ apiKey: cfg.BAGSEVEN_SECRET_KEY, baseUrl: daemonUrl });
  assert.equal((await sdk.checkEntitlement('ocr', { holder })).enabled, true);
  const usage = { feature: 'ocr', holder, amount: '1', idempotencyKey: `sdk-${randomUUID()}`, grant_id: minted.grant.id };
  await sdk.consumeEntitlement(usage);
  const replay = await sdk.consumeEntitlement(usage);
  assert.equal(replay.entitlement.remaining, '18');
  const publicClient = new BagsevenClient({ apiKey: cfg.BAGSEVEN_PUBLISHABLE_KEY, baseUrl: daemonUrl });
  await assert.rejects(() => publicClient.consumeEntitlement({ ...usage, idempotencyKey: randomUUID() }), error => error instanceof BagsevenApiError && error.status === 403);
  console.log('PASS SDK access, idempotent consumption and publishable-key write refusal');

  const { client, transport } = await connect();
  try {
    const tools = (await client.listTools()).tools.map(entry => entry.name);
    for (const name of ['bagseven_status', 'grant_status', 'paid_run', 'create_plan', 'get_checkout_session', 'explain_denial', 'bagseven_fetch']) assert.ok(tools.includes(name));
    const worker = await tool(client, 'bagseven_status');
    assert.equal(worker.agent.id, cfg.BAGSEVEN_MCP_WORKER);
    assert.ok(Number(worker.remaining.can_draw) > 0);
    const args = { grant_id: minted.grant.id, amount: '11', work: 'prepaid-e2e', idempotency_key: `mcp-${randomUUID()}` };
    assert.equal((await tool(client, 'paid_run', args)).grant.remaining, '7');
    assert.equal((await tool(client, 'paid_run', args)).grant.remaining, '7');
    assert.match(await tool(client, 'paid_run', { grant_id: minted.grant.id, amount: '8' }, true), /GRANT_EMPTY/);
    const cancel = await tool(client, 'cancel_renewal', { grant_id: minted.grant.id });
    assert.equal(cancel.grant.renewal_enabled, false);
    assert.equal(cancel.grant.paid_through, minted.grant.paid_through);
    assert.deepEqual((await tool(client, 'paid_run', { grant_id: minted.grant.id, amount: '1', idempotency_key: randomUUID() })).dual_gate, { mandate: 'not_required', grant: 'ok' });

    const plan = await tool(client, 'create_plan', { name: `Local E2E ${randomUUID()}`, feature: 'ocr', amount: '1.00', credits: '5', ttl_seconds: 600, merchant_wallet: worker.mandate.owner_address });
    const checkout = await tool(client, 'mint_with_world', { plan_id: plan.plan.id, feature: 'ocr', holder });
    assert.ok(checkout.requires_wallet_payment && checkout.checkout_url);
    const id = checkout.session.id;
    assert.equal((await tool(client, 'get_checkout_session', { checkout_id: id })).session.status, 'PENDING');
    assert.match(await (await request(consoleUrl, `/checkout?session=${id}`)).text(), /Bagseven/i);
    const confirmed = await (await request(daemonUrl, `/v1/public/checkout/${id}/confirm`, { method: 'POST', body: { payment_tx: `0x${randomBytes(32).toString('hex')}`, customer_wallet: worker.mandate.owner_address } })).json();
    assert.equal(confirmed.verification, 'demo');
    assert.equal(confirmed.grant.remaining, '5');
    assert.equal((await tool(client, 'get_checkout_session', { checkout_id: id })).session.status, 'PAID');
    console.log('PASS MCP prepaid credits, renewal cancellation and provider checkout confirmation');

    await mint(holder, 'research_fetch');
    const payment = { amount: '0.10', recipient: worker.mandate.owner_address, reason: 'isolated local Anvil payment', idempotency_key: randomUUID() };
    const paid = await tool(client, 'bagseven_fetch', payment);
    assert.equal(paid.decision, 'allow');
    assert.match(paid.tx_hash, /^0x[0-9a-f]{64}$/i);
    assert.equal((await tool(client, 'bagseven_fetch', payment)).tx_hash, paid.tx_hash);
    const overCap = await client.callTool({ name: 'bagseven_fetch', arguments: { ...payment, amount: '11', idempotency_key: randomUUID() } });
    assert.ok(overCap.isError || JSON.stringify(overCap).includes('refused'), 'Payment over the per-purchase cap must be refused');
    console.log('PASS local onchain payment, retry idempotency and mandate cap refusal');

    const accessWorker = randomUUID();
    const accessOnly = await mint(holder, 'ocr', { worker_id: accessWorker, remaining: '2' });
    const isolated = await connect(accessWorker);
    try {
      assert.equal((await tool(isolated.client, 'bagseven_status')).mode, 'entitlements_only');
      assert.equal((await tool(isolated.client, 'paid_run', { grant_id: accessOnly.grant.id, idempotency_key: randomUUID() })).grant.remaining, '1');
      const paymentDenied = await isolated.client.callTool({ name: 'bagseven_fetch', arguments: { amount: '0.01', recipient: worker.mandate.owner_address, idempotency_key: randomUUID() } });
      assert.equal(paymentDenied.isError, true);
    } finally { await isolated.client.close(); await isolated.transport.close(); }
    const expiring = await mint(holder, 'ocr', { ttl_seconds: 1 });
    await sleep(Math.max(0, new Date(expiring.grant.paid_through).getTime() - Date.now()) + 100);
    assert.ok(!(await tool(client, 'grant_status', { holder })).grants.some(grant => grant.id === expiring.grant.id));
    assert.match(await tool(client, 'paid_run', { grant_id: expiring.grant.id }, true), /GRANT_EXPIRED/);
    assert.equal((await tool(client, 'explain_denial', { grant_id: expiring.grant.id })).denied, true);
    console.log('PASS entitlement-only agent access, new-payment refusal and grant expiry');
  } finally { await client.close(); await transport.close(); }
  const logout = await request(consoleUrl, '/api/auth/logout', { method: 'POST', status: 303 });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  cookie = undefined;
  await request(consoleUrl, '/api/daemon/grants/live', { status: 401 });
  console.log('E2E_OK (isolated Anvil, memory grants, mocked World, email suppressed)');
}
main().catch(error => { console.error('E2E_FAIL', error.message); process.exitCode = 1; });
