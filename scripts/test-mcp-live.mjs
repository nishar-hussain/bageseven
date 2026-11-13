#!/usr/bin/env node
// Real local MCP stdio clients -> running daemon/policy -> public Avalanche and Registry.
// Public HTTP OAuth is verified separately; no account credentials or payment receipts are mocked.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MandateClient, avalancheConfig } from '@bagseven/onchain';
import { RegistryGrantStore } from '@bagseven/entitlements';
const e = parseEnv(readFileSync('.env', 'utf8'));
assert.equal(e.AVALANCHE_DEMO_SETTLE, 'false'); assert.equal(e.ENTITLEMENT_STORE, 'avalanche');
const rail = avalancheConfig(e); assert.equal(rail.chainId, 43113);
const payer = privateKeyToAccount(e.AVALANCHE_PRIVATE_KEY), executor = privateKeyToAccount(e.DAEMON_EXECUTOR_KEY);
const rpc = createPublicClient({ chain: rail.chain, transport: http(rail.rpcUrl) });
const wallet = createWalletClient({ account: payer, chain: rail.chain, transport: http(rail.rpcUrl) });
const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function transfer(address,uint256) returns(bool)']);
const balance = address => rpc.readContract({ address: rail.usdt, abi: tokenAbi, functionName: 'balanceOf', args: [address] });
const report = 'docs/testing/mcp-agents-mandates-live-2026-11-07.json';
const priorRun = JSON.parse(readFileSync('docs/testing/avalanche-public-payment-2026-11-07.json', 'utf8'));
const state = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : { scope: 'Real trusted local MCP clients, PostgreSQL, public Avalanche 43113 and live Registry; OAuth tested separately', checks: [], provider: '0x2E9302Da9c2925b2b4e22C47E3c26C46220C46CC', root_worker: e.BAGSEVEN_MCP_WORKER, token: rail.usdt };
const save = () => writeFileSync(report, JSON.stringify(state, null, 2) + '\n');
const pass = name => { if (!state.checks.includes(name)) state.checks.push(name); save(); console.log('PASS', name); };
const wait = async hash => { const receipt = await rpc.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120000 }); assert.equal(receipt.status, 'success'); return receipt; };
async function api(path, body) {
 const r = await fetch('http://localhost:4001' + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${e.DAEMON_AUTH_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
 const data = await r.json(); assert.equal(r.status, 200, `${path}: ${JSON.stringify(data).slice(0, 400)}`); return data;
}
function unpack(result) { const value = result.content?.find(item => item.type === 'text')?.text; try { return JSON.parse(value); } catch { return value ?? result; } }
async function connect(worker) {
 const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'scripts/bagseven-mcp.ts'], env: { ...process.env, ...e, BAGSEVEN_MCP_PORT: '', MCP_HTTP_PORT: '', BAGSEVEN_MCP_WORKER: worker, NOTIFY_MODE: 'log' }, stderr: 'pipe' });
 transport.stderr?.on('data', data => appendFileSync('/tmp/bagseven-mcp-e2e-stdio.log', data));
 const client = new Client({ name: 'bagseven-real-agent-e2e', version: '1.0' }); await client.connect(transport);
 return { client, transport, call: async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 }); if (result.isError) throw new Error(`${name}: ${JSON.stringify(unpack(result)).slice(0, 800)}`); return unpack(result); }, denied: async (name, args) => { const result = await client.callTool({ name, arguments: args }); const data = unpack(result); assert.ok(result.isError || data?.decision === 'refused', `${name} unexpectedly permitted`); return data; } };
}
const root = await connect(state.root_worker); let child;
try {
 const names = (await root.client.listTools()).tools.map(tool => tool.name); state.tools = names; save();
 for (const name of ['list_mandates', 'get_mandate', 'list_agents', 'get_agent', 'prepare_mandate', 'create_mandate', 'prepare_mandate_funding', 'list_agent_entitlements', 'list_features', 'list_plans', 'create_plan', 'create_checkout_session', 'paid_run', 'bagseven_fetch', 'bagseven_spawn']) assert.ok(names.includes(name), name);
 pass('MCP protocol discovery exposes mandate, agent, payment and entitlement tools');
 const status = await root.call('bagseven_status'); assert.equal(status.agent.id, state.root_worker); state.root_mandate = status.mandate.id; save();
 assert.ok((await root.call('list_mandates')).mandates.some(m => m.id === status.mandate.id));
 assert.ok((await root.call('list_agents')).agents.some(a => a.id === state.root_worker));
 assert.equal((await root.call('get_agent')).agent.id, state.root_worker); pass('MCP discovers the real owned mandate and bound root agent without pasted IDs');
 assert.equal((await root.call('get_mandate')).onchain_revoked, false);
 const currentTokens = await balance(payer.address);
 state.initial_wallet_units ??= String(currentTokens); save();
 assert.ok(parseUnits(priorRun.total_usdt_used, 6) + BigInt(state.initial_wallet_units) - currentTokens < 800000n, 'Authorized test budget is almost exhausted');
 assert.ok(currentTokens >= 110000n, 'Buyer needs 0.11 USDT for the isolated test');
 if (!state.gas_tx && await rpc.getBalance({ address: executor.address }) < parseEther('0.02')) { state.gas_tx = await wallet.sendTransaction({ to: executor.address, value: parseEther('0.02') }); save(); }
 if (state.gas_tx) await wait(state.gas_tx);
 if (!state.created_mandate) {
  const terms = { operator_address: executor.address, budget_per_window: '0.10', window_seconds: 86400, lifetime_cap: '0.10', per_purchase_cap: '0.10', per_seller_pct: 10000, max_depth: 1 };
  const prepared = await root.call('prepare_mandate', terms); assert.equal(prepared.owner_address.toLowerCase(), payer.address.toLowerCase()); assert.equal(prepared.requires_owner_signature, true);
  const signature = await payer.signMessage({ message: prepared.message });
  state.created_mandate = await root.call('create_mandate', { ...terms, signature }); save();
 }
 pass('MCP prepared owner approval and deployed a real signed Avalanche mandate with its root agent');
 if (!state.fund_tx) {
  const prepared = await root.call('prepare_mandate_funding', { mandate_id: state.created_mandate.mandate_id, amount: '0.01' });
  assert.equal(prepared.requires_wallet_approval, true); assert.equal(prepared.transaction.to.toLowerCase(), rail.usdt.toLowerCase());
  state.fund_tx = await wallet.sendTransaction({ to: prepared.transaction.to, data: prepared.transaction.data, value: 0n }); save();
 }
 await wait(state.fund_tx); assert.equal(await balance(state.created_mandate.contract_address), state.revoked ? 0n : 10000n);
 pass('MCP funding draft transferred exactly 0.01 real USDT after wallet approval');
 if (!state.child) { state.child = await root.call('bagseven_spawn', { operator_address: executor.address, share_percent: 1 }); save(); }
 const childInfo = await root.call('get_agent', { agent_id: state.child.agent_id });
 assert.equal(Number(childInfo.agent.allocation), 0.001); assert.equal(childInfo.agent.onchain_active, true);
 assert.ok((await root.call('list_agents')).agents.some(a => a.id === state.child.agent_id));
 pass('MCP registered a child on-chain with an exact 0.001 USDT allocation');
 if (!state.plan) { state.plan = (await root.call('create_plan', { name: 'Real MCP research access', feature: 'research_fetch', amount: '0.05', credits: '3', ttl_seconds: 86400, merchant_wallet: state.provider, interval: 'month' })).plan; save(); }
 assert.ok((await root.call('list_plans')).plans.some(p => p.id === state.plan.id));
 assert.ok((await root.call('list_features')).features.some(f => f.id === 'research_fetch'));
 async function purchase(key, worker) {
  state[key] ??= {}; const record = state[key];
  if (!record.checkout) { record.checkout = (await root.call('create_checkout_session', { plan_id: state.plan.id, holder: `wallet:${payer.address.toLowerCase()}`, worker_id: worker })).session; save(); }
  assert.equal(record.checkout.worker_id, worker);
  if (!record.payment_tx) { record.payment_tx = await wallet.writeContract({ address: rail.usdt, abi: tokenAbi, functionName: 'transfer', args: [state.provider, 50000n] }); save(); }
  await wait(record.payment_tx);
  if (!record.grant) {
   const context = `Bagseven payment confirmation\nContext: checkout:${record.checkout.id}\nChain: 43113\nTransaction: ${record.payment_tx.toLowerCase()}`;
   const paid = await api(`/v1/public/checkout/${record.checkout.id}/confirm`, { payment_tx: record.payment_tx, customer_wallet: payer.address, payment_signature: await payer.signMessage({ message: context }) });
   assert.equal(paid.verification, 'verified'); assert.equal(paid.grant.worker_id, worker); record.grant = paid.grant; save();
  }
  const checkout = (await root.call('get_checkout_session', { checkout_id: record.checkout.id })).session;
  assert.equal(checkout.status, 'PAID'); assert.equal(checkout.platform_fee_amount, '0.00005');
  return record;
 }
 const rootAccess = await purchase('root_access', state.root_worker);
 const childAccess = await purchase('child_access', state.child.agent_id);
 pass('Real provider checkouts minted separate live Registry grants for root and child with exact 0.1% fees');
 assert.equal((await root.call('check_entitlement', { feature: 'research_fetch' })).enabled, true);
 assert.ok((await root.call('list_agent_entitlements')).grants.every(g => g.worker_id === state.root_worker));
 child = await connect(state.child.agent_id);
 assert.equal((await child.call('check_entitlement', { feature: 'research_fetch' })).enabled, true);
 assert.ok((await child.call('list_agent_entitlements')).grants.every(g => g.worker_id === state.child.agent_id));
 await child.denied('paid_run', { feature: 'ocr', amount: '0.0001' });
 pass('Root and child MCP clients read only their own bound entitlements; unrelated OCR access is denied');
 if (!state.paid_run) { state.paid_run = await root.call('paid_run', { feature: 'ocr', amount: '0.01', idempotency_key: 'mcp-live-2026-11-07-paid-run' }); save(); }
 const repeatedRun = await root.call('paid_run', { feature: 'ocr', amount: '0.01', idempotency_key: 'mcp-live-2026-11-07-paid-run' });
 assert.equal(repeatedRun.grant.remaining, state.paid_run.grant.remaining); pass('MCP paid run passes both real gates and retries do not burn extra credits');
 const spendArgs = { amount: '0.01', recipient: state.provider, reason: 'Real MCP root payment', idempotency_key: 'mcp-live-2026-11-07-root-payment' };
 if (!state.root_spend) { state.root_spend = await root.call('bagseven_fetch', spendArgs); save(); }
 assert.equal(state.root_spend.decision, 'allow'); assert.ok(state.root_spend.tx_hash);
 const vaultAfter = await balance(status.mandate.contract_address);
 const repeatedSpend = await root.call('bagseven_fetch', spendArgs);
 assert.equal(repeatedSpend.tx_hash, state.root_spend.tx_hash); assert.equal(await balance(status.mandate.contract_address), vaultAfter);
 pass('Root MCP transferred real USDT to the provider; retry reused the same transaction');
 const childArgs = { amount: '0.0001', recipient: state.provider, reason: 'Real MCP child payment', idempotency_key: 'mcp-live-2026-11-07-child-payment' };
 if (!state.child_spend) { state.child_spend = await child.call('bagseven_fetch', childArgs); save(); }
 assert.equal(state.child_spend.decision, 'allow'); assert.ok(state.child_spend.tx_hash);
 pass('A separately bound child MCP client spent real USDT within its on-chain allocation');
 const childGrantBefore = await RegistryGrantStore.fromEnv(e).get(childAccess.grant.id);
 const beforeDenied = await balance(status.mandate.contract_address);
 await child.denied('bagseven_fetch', { amount: '0.002', recipient: state.provider, idempotency_key: 'mcp-live-deny-child-cap' });
 await root.denied('bagseven_fetch', { amount: '0.20', recipient: state.provider, idempotency_key: 'mcp-live-deny-root-cap' });
 await root.denied('paid_run', { grant_id: childAccess.grant.id, amount: '0.0001' });
 assert.equal(await balance(status.mandate.contract_address), beforeDenied);
 assert.equal((await RegistryGrantStore.fromEnv(e).get(childAccess.grant.id)).remaining, childGrantBefore.remaining);
 pass('Overspending and cross-agent entitlement use were denied without moving funds or burning credits');
 await root.call('cancel_renewal', { grant_id: rootAccess.grant.id });
 assert.equal((await root.call('check_entitlement', { feature: 'research_fetch' })).enabled, true);
 const fresh = await RegistryGrantStore.fromEnv(e).get(rootAccess.grant.id); assert.equal(fresh.renewal_enabled, false); assert.equal(fresh.remaining, '2');
 pass('Cancellation disabled renewal while preserving paid-through access; independent Registry reads confirm usage');
 const ownerClient = new MandateClient(e.AVALANCHE_PRIVATE_KEY, { rpcUrl: rail.rpcUrl, chainId: 43113 });
 if (!state.revoke_tx) { state.revoke_tx = await ownerClient.revoke(state.created_mandate.contract_address); save(); }
 await wait(state.revoke_tx);
 const revoked = await root.call('get_mandate', { mandate_id: state.created_mandate.mandate_id });
 assert.equal(revoked.overview.onchain_revoked, true); assert.equal(Number(revoked.overview.can_be_drawn_now), 0);
 if (!state.recover_tx) { state.recover_tx = await ownerClient.withdraw(state.created_mandate.contract_address, 10000n, payer.address); save(); }
 await wait(state.recover_tx); assert.equal(await balance(state.created_mandate.contract_address), 0n); state.revoked = true; save();
 pass('Isolated test mandate was revoked on-chain and its 0.01 USDT recovered; the original mandate remains active');
 const used = parseUnits(priorRun.total_usdt_used, 6) + BigInt(state.initial_wallet_units) - await balance(payer.address); assert.ok(used <= 1000000n);
 state.cumulative_usdt_used = formatUnits(used, 6); state.root_vault_usdt = formatUnits(await balance(status.mandate.contract_address), 6);
 delete state.last_error; state.result = 'PASS'; state.finished_at = new Date().toISOString(); save();
 console.log('PASS all live MCP checks; cumulative USDT used:', state.cumulative_usdt_used);
} catch (error) { state.result = 'INCOMPLETE'; state.last_error = error.message; save(); throw error; }
finally { await child?.client.close().catch(() => {}); await root.client.close().catch(() => {}); }
