#!/usr/bin/env node
// Exercises mandate creation, funding, caps, signatures, delegation, withdrawal,
// revocation, and the dashboard request contract against a LOCAL stack.
// Start the stack with NOTIFY_MODE=log. Then:
//   NOTIFY_MODE=log node --env-file=.env scripts/test-mandate-flow.mjs
// Use BAGSEVEN_E2E_ENV_FILE to select a separate env file and
// BAGSEVEN_E2E_REPORT to save JSON results. Creates local mandates and payments.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { canonicalMandate, canonicalSpawn, canonicalWithdraw, spendIntentDomain, spendIntentTypes, MandateClient } from '@bagseven/onchain';
process.loadEnvFile(process.env.BAGSEVEN_E2E_ENV_FILE || new URL('../.env', import.meta.url));
const cfg = process.env, owner = privateKeyToAccount(cfg.DAEMON_OWNER_KEY), operator = privateKeyToAccount(cfg.DAEMON_OPERATOR_KEY);
const chain = new MandateClient(cfg.DAEMON_EXECUTOR_KEY, { rpcUrl: cfg.RPC_URL, chainId: 43113 });
const ownerChain = new MandateClient(cfg.DAEMON_OWNER_KEY, { rpcUrl: cfg.RPC_URL, chainId: 43113 });
assert.equal(cfg.DEV_MODE, 'true', 'Requires a local development stack');
assert.equal(cfg.ENTITLEMENT_STORE, 'memory', 'Requires memory grants');
assert.equal(cfg.WORLD_MOCK_PROOFS, 'true', 'Requires mock World proofs');
assert.equal(cfg.HEDERA_DEMO_SETTLE, 'true', 'Requires demo Hedera settlement');
assert.equal(cfg.NOTIFY_MODE, 'log', 'Start the stack and checks with NOTIFY_MODE=log');
assert.equal(cfg.BAGSEVEN_REQUIRE_GRANT, 'true', 'Both gates must be enabled');
const gateway = cfg.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';
const daemon = cfg.DAEMON_URL || 'http://localhost:4001';
const consoleUrl = cfg.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3000';
const policy = cfg.POLICY_URL || 'http://localhost:4003';
for (const endpoint of [gateway, daemon, consoleUrl, policy, cfg.RPC_URL, cfg.RPC_FALLBACK_URL || cfg.RPC_URL, cfg.DATABASE_URL, cfg.REDIS_URL]) {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname), 'All endpoints must be local');
}
assert.equal(await chain.publicClient.getChainId(), 43113);
assert.match(await chain.publicClient.request({ method: 'web3_clientVersion' }), /anvil/i);
const running = await fetch(daemon + '/internal/mumbai/status', { headers: { authorization: `Bearer ${cfg.DAEMON_AUTH_TOKEN}` }, signal: AbortSignal.timeout(10000) });
assert.equal(running.status, 200);
const runningStatus = await running.json();
assert.equal(runningStatus.notifications.delivery, 'log', 'Restart the stack with NOTIFY_MODE=log');
assert.equal(runningStatus.tracks.arkiv.store, 'memory', 'Running stack must use memory grants');
const results = [];
let cookie;
let nextNonce = Date.now();
async function req(base, path, { body, headers = {}, status = 200, auth = false } = {}) {
    const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { authorization: `Bearer ${cfg.DAEMON_AUTH_TOKEN}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const raw = await res.text();
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch {
        data = raw;
    }
    assert.equal(res.status, status, `${path}: ${res.status} ${raw.slice(0, 500)}`);
    return { data, res };
}
const api = async (path, body, extra = {}) => (await req(gateway, path, { body, ...extra })).data;
const internal = async (path, body, status = 200) => (await req(daemon, '/internal/' + path, { body, status, auth: true })).data;
const bff = async (path, body, status = 200) => (await req(consoleUrl, '/api/daemon/' + path, { body, status, headers: { cookie } })).data;
async function test(name, fn) {
    try {
        const evidence = await fn();
        results.push({ name, status: 'PASS', evidence });
        console.log('PASS ' + name + (evidence ? ' ' + JSON.stringify(evidence) : ''));
    }
    catch (e) {
        results.push({ name, status: 'FAIL', error: e.message });
        console.log('FAIL ' + name + ' ' + e.message);
    }
}
async function creationBody(terms = {}) {
    const input = { owner: owner.address.toLowerCase(), operator: operator.address.toLowerCase(), budgetPerWindow: '1000.00', windowSeconds: 86400, lifetimeCap: '1000.00', perPurchaseCap: '10.00', perSellerPct: 10000, maxDepth: 2, chainId: 43113, ...terms };
    return { owner_address: input.owner, operator_address: input.operator, budget_per_window: input.budgetPerWindow, window_seconds: input.windowSeconds, lifetime_cap: input.lifetimeCap, per_purchase_cap: input.perPurchaseCap, per_seller_pct: input.perSellerPct, max_depth: input.maxDepth, chain_id: input.chainId, signature: await owner.signMessage({ message: canonicalMandate(input) }) };
}
async function create(terms = {}, fund = '20.00') {
    const m = await api('/v1/mandates', await creationBody(terms));
    if (fund)
        await api(`/v1/vaults/${m.mandate_id}/fund`, { amount: fund });
    return m;
}
async function grant(worker, remaining = '20') {
    return (await internal('grants/mint', { holder: `matrix-${randomUUID()}`, feature: 'ocr', remaining, ttl_seconds: 1800, world_proof_id: 'world:ok:matrix', renewal_enabled: true, ...(worker ? { worker_id: worker } : {}) })).grant;
}
async function fetchWork(worker, amount, status = 200) {
    return internal(`workers/${worker}/fetch`, { amount, recipient: owner.address, reason: 'isolated mandate matrix' }, status);
}
async function overview(m) {
    return api(`/v1/mandates/${m.mandate_id}/overview`);
}
async function getGrant(g) {
    return (await internal('grants/' + g.id)).grant;
}
async function intent(worker, amount, opts = {}) {
    const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000), nonce = opts.nonce ?? nextNonce++, chainId = opts.chainId ?? 43113;
    const message = { agentId: worker, amount, recipient: owner.address, nonce: BigInt(nonce), timestamp: BigInt(timestamp), chainId: BigInt(chainId) };
    return { agent_id: worker, amount, recipient: owner.address, nonce, timestamp, chain_id: chainId, signature: await (opts.signer ?? operator).signTypedData({ domain: spendIntentDomain(chainId), types: spendIntentTypes, primaryType: 'SpendIntent', message }) };
}
async function spawn(m, parent, share = 10) {
    return api(`/v1/mandates/${m.mandate_id}/spawn-agent`, { parent_agent_id: parent, operator_address: operator.address, share_percent: share, chain_id: 43113, signature: await owner.signMessage({ message: canonicalSpawn({ mandateId: m.mandate_id, parentAgentId: parent, operator: operator.address.toLowerCase(), sharePercent: share, chainId: 43113 }) }) });
}
await test('Owner signature mismatch rejected', async () => {
    const body = await creationBody();
    body.signature = await operator.signMessage({ message: 'wrong-owner' });
    const r = await api('/v1/mandates', body, { status: 403 });
    assert.equal(r.error.code, 'SIGNATURE_MISMATCH');
});
let main, g;
await test('Create mandate through gateway and fund vault', async () => {
    main = await create();
    const o = await overview(main);
    assert.equal(o.vault_available, '20.00');
    assert.equal(o.can_be_drawn_now, '20.00');
    assert.equal(o.agents.length, 1);
    assert.ok(await chain.publicClient.getCode({ address: main.contract_address }));
    return main;
});
await test('Create retry with idempotency key returns same mandate', async () => {
    const body = await creationBody(), headers = { 'idempotency-key': randomUUID() };
    const a = await api('/v1/mandates', body, { headers });
    const b = await api('/v1/mandates', body, { headers });
    assert.equal(a.mandate_id, b.mandate_id);
});
await test('Missing grant blocks funded worker', async () => {
    const r = await fetchWork(main.root_agent_id, '1', 403);
    assert.match(r.error.message, /GRANT_EXPIRED/);
});
await test('Mint grant and execute local token payment', async () => {
    g = await grant(main.root_agent_id);
    const before = await overview(main), recipientBefore = await chain.publicClient.readContract({ address: cfg.USDC_ADDRESS, abi: parseAbi(['function balanceOf(address) view returns(uint256)']), functionName: 'balanceOf', args: [owner.address] });
    const r = await fetchWork(main.root_agent_id, '1.00');
    assert.equal(r.decision, 'allow');
    const receipt = await chain.publicClient.getTransactionReceipt({ hash: r.tx_hash });
    assert.equal(receipt.status, 'success');
    const after = await overview(main);
    assert.equal(Number(before.vault_available) - Number(after.vault_available), 1);
    assert.equal(after.spent_total, '1.00');
    assert.equal((await getGrant(g)).remaining, '19');
    const balance = await chain.publicClient.readContract({ address: cfg.USDC_ADDRESS, abi: parseAbi(['function balanceOf(address) view returns(uint256)']), functionName: 'balanceOf', args: [owner.address] });
    assert.equal(balance - recipientBefore, 1000000n);
    return { tx_hash: r.tx_hash, vault: after.vault_available, spent: after.spent_total };
});
await test('Per-purchase cap refuses without charging tokens or credits', async () => {
    const before = await overview(main), gb = await getGrant(g);
    const r = await fetchWork(main.root_agent_id, '10.01');
    assert.equal(r.decision, 'refused');
    assert.equal(r.bound, 'PerTxCapExceeded');
    assert.equal((await overview(main)).vault_available, before.vault_available);
    assert.equal((await getGrant(g)).remaining, gb.remaining);
});
await test('Exact per-purchase cap is allowed', async () => {
    const r = await fetchWork(main.root_agent_id, '10.00');
    assert.equal(r.decision, 'allow');
});
await test('Signed withdrawal reduces vault and wrong owner is rejected', async () => {
    const before = await overview(main);
    const body = { amount: '1.00', to_address: owner.address.toLowerCase(), chain_id: 43113, signature: await owner.signMessage({ message: canonicalWithdraw({ mandateId: main.mandate_id, amount: '1.00', to: owner.address.toLowerCase(), chainId: 43113 }) }) };
    const ok = await api(`/v1/vaults/${main.mandate_id}/withdraw`, body);
    assert.equal(Number(before.vault_available) - Number(ok.vault_balance), 1);
    const bad = await api(`/v1/vaults/${main.mandate_id}/withdraw`, { ...body, signature: await operator.signMessage({ message: 'unauthorized' }) }, { status: 403 });
    assert.equal(bad.error.code, 'SIGNATURE_MISMATCH');
});
await test('Spend intent wrong operator and stale timestamp rejected', async () => {
    const wrong = await api('/v1/spend-intents', await intent(main.root_agent_id, '0.01', { signer: owner }), { status: 403 });
    assert.equal(wrong.error.code, 'OPERATOR_MISMATCH');
    const stale = await api('/v1/spend-intents', await intent(main.root_agent_id, '0.01', { timestamp: Math.floor(Date.now() / 1000) - 600 }), { status: 400 });
    assert.equal(stale.error.code, 'SPEND_INTENT_EXPIRED');
});
await test('Nonce replay rejected and settlement requires internal authorization', async () => {
    const body = await intent(main.root_agent_id, '0.01');
    const accepted = await api('/v1/spend-intents', body);
    assert.equal(accepted.decision, 'allow');
    assert.equal((await api('/v1/spend-intents', body, { status: 409 })).error.code, 'NONCE_REUSED');
    assert.equal((await api(`/v1/reservations/${accepted.reservation_id}/settle`, { tx_hash: '0xtest', recipient: owner.address }, { status: 401 })).error.code, 'UNAUTHORIZED');
    await req(policy, `/v1/reservations/${accepted.reservation_id}/release`, { body: {}, headers: { authorization: `Bearer ${cfg.POLICY_INTERNAL_TOKEN}` } });
});
for (const [name, terms, fund, first, second, bound] of [
    ['Window budget', { budgetPerWindow: '2.00' }, '20.00', '1.50', '1.00', 'DailyCapExceeded'],
    ['Lifetime budget', { lifetimeCap: '2.00' }, '20.00', '1.50', '1.00', 'LifetimeCapExceeded'],
    ['Seller concentration', { lifetimeCap: '10.00', perSellerPct: 1000 }, '20.00', '0.75', '0.50', 'PerSellerCapExceeded'],
    ['Vault balance', {}, '1.00', '0.75', '0.50', 'VaultInsufficient'],
])
    await test(name + ' enforced by payment path', async () => {
        const m = await create(terms, fund), gr = await grant(m.root_agent_id);
        assert.equal((await fetchWork(m.root_agent_id, first)).decision, 'allow');
        const before = await overview(m), remaining = (await getGrant(gr)).remaining;
        const denied = await fetchWork(m.root_agent_id, second);
        assert.equal(denied.decision, 'refused');
        assert.equal(denied.bound, bound);
        assert.equal((await overview(m)).vault_available, before.vault_available);
        assert.equal((await getGrant(gr)).remaining, remaining);
    });
let delegation, child, childGrant;
await test('Child allocation and depth limits enforced', async () => {
    delegation = await create({ lifetimeCap: '10.00', maxDepth: 1 });
    child = await spawn(delegation, delegation.root_agent_id, 10);
    assert.equal(child.depth, 1);
    childGrant = await grant(child.agent_id);
    assert.equal((await fetchWork(child.agent_id, '0.75')).decision, 'allow');
    const denied = await fetchWork(child.agent_id, '0.50');
    assert.equal(denied.bound, 'WorkerAllocationExceeded');
    const deep = await req(gateway, `/v1/mandates/${delegation.mandate_id}/spawn-agent`, { body: { parent_agent_id: child.agent_id, operator_address: operator.address, share_percent: 10, chain_id: 43113, signature: await owner.signMessage({ message: canonicalSpawn({ mandateId: delegation.mandate_id, parentAgentId: child.agent_id, operator: operator.address.toLowerCase(), sharePercent: 10, chainId: 43113 }) }) }, status: 400 });
    assert.equal(deep.data.error.code, 'EXCEEDS_MAX_DEPTH');
});
await test('paid_run refuses exhausted child allocation', async () => {
    const r = await internal('grants/paid-run', { grant_id: childGrant.id, worker_id: child.agent_id, amount: '1.00' }, 403);
    assert.match(r.error.message, /MANDATE_EMPTY/);
});
await test('Grant exhaustion blocks further payment', async () => {
    const m = await create(), gr = await grant(m.root_agent_id, '1');
    assert.equal((await fetchWork(m.root_agent_id, '0.01')).decision, 'allow');
    const denied = await fetchWork(m.root_agent_id, '0.01', 403);
    assert.match(denied.error.message, /GRANT_EMPTY/);
    assert.equal((await getGrant(gr)).remaining, '0');
});
await test('Cancellation preserves paid_through and current access', async () => {
    const before = await getGrant(g);
    const cancel = await internal(`grants/${g.id}/cancel-renewal`, {});
    assert.equal(cancel.grant.renewal_enabled, false);
    assert.equal(cancel.grant.paid_through, before.paid_through);
    assert.equal((await fetchWork(main.root_agent_id, '0.01')).decision, 'allow');
});
await test('Browser form mint binds worker for paid_run', async () => {
    const magic = await req(consoleUrl, '/api/auth/magic', { body: { email: 'matrix@bagseven.local' } });
    const u = new URL(magic.data.dev_hint);
    const callback = await req(consoleUrl, u.pathname + u.search, { status: 307 });
    cookie = callback.res.headers.get('set-cookie').split(';')[0];
    const minted = await bff('grants/mint', { holder: 'matrix-ui', feature: 'ocr', remaining: '3', ttl_seconds: 120, world_proof_id: 'world:ok:matrix-ui', renewal_enabled: true });
    assert.equal(minted.grant.worker_id, cfg.BAGSEVEN_MCP_WORKER);
    const result = await bff('grants/paid-run', { grant_id: minted.grant.id, amount: '1', work: 'ocr unit' });
    assert.equal(result.grant.remaining, '2');
});
await test('paid_run repeated idempotency key consumes only once', async () => {
    const gr = await grant(main.root_agent_id, '3');
    const body = { grant_id: gr.id, amount: '1', worker_id: main.root_agent_id, idempotency_key: randomUUID() };
    const first = await internal('grants/paid-run', body), second = await internal('grants/paid-run', body);
    assert.equal(first.grant.remaining, '2');
    assert.equal(second.grant.remaining, '2');
    assert.equal((await getGrant(gr)).remaining, '2');
});
await test('Revocation blocks payment and paid_run', async () => {
    const m = await create(), gr = await grant(m.root_agent_id);
    await ownerChain.revoke(m.contract_address);
    const denied = await fetchWork(m.root_agent_id, '1');
    assert.equal(denied.decision, 'refused');
    assert.equal(denied.bound, 'MandateInactive');
    const paid = await internal('grants/paid-run', { grant_id: gr.id, amount: '1', worker_id: m.root_agent_id }, 403);
    assert.match(paid.error.message, /MANDATE_EMPTY/);
});
await test('Mandate signature for another chain is rejected', async () => {
    const body = await creationBody({ chainId: 1 });
    await api('/v1/mandates', body, { status: 400 });
});
if (cfg.BAGSEVEN_E2E_REPORT)
    writeFileSync(cfg.BAGSEVEN_E2E_REPORT, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length }));
process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
