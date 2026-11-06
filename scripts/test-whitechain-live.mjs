#!/usr/bin/env node
// Authorized public testnet run. Fixed USDT budget: 0.10 checkout + 0.10 vault.
// Resume checkpoints prevent resending a successful payment after a failed API call.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { canonicalMandate, whitechainConfig } from '@bagseven/onchain';
const env = parseEnv(readFileSync('.env', 'utf8'));
const report = 'docs/testing/whitechain-public-payment-2026-11-07.json';
const state = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : {
  network: 'Whitechain Sepolia', chain_id: 1874,
  provider: '0x2E9302Da9c2925b2b4e22C47E3c26C46220C46CC',
  checkout_usdt: '0.10', mandate_vault_usdt: '0.10', maximum_usdt_budget: '1', checks: [],
};
const save = () => writeFileSync(report, JSON.stringify(state, null, 2) + '\n');
const check = name => { if (!state.checks.includes(name)) state.checks.push(name); save(); console.log('PASS', name); };
const config = whitechainConfig(env);
assert.equal(config.chainId, 1874); assert.equal(env.WORLD_MOCK_PROOFS, 'false');
assert.equal(env.WHITECHAIN_DEMO_SETTLE, 'false'); assert.equal(env.ENTITLEMENT_STORE, 'arkiv');
const account = privateKeyToAccount(env.WHITECHAIN_PRIVATE_KEY);
const executor = privateKeyToAccount(env.DAEMON_EXECUTOR_KEY);
const rpc = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
const wallet = createWalletClient({ account, chain: config.chain, transport: http(config.rpcUrl) });
const abi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function transfer(address,uint256) returns(bool)']);
const balance = address => rpc.readContract({ address: config.usdt, abi, functionName: 'balanceOf', args: [address] });
const wait = async hash => { const receipt = await rpc.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120000 }); assert.equal(receipt.status, 'success'); return receipt; };
async function api(base, path, body, extra = {}) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${env.DAEMON_AUTH_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data).slice(0, 700)}`);
  return data;
}
const daemon = env.DAEMON_URL || 'http://localhost:4001';
const policy = env.POLICY_URL || 'http://localhost:4003';
assert.equal(await rpc.getChainId(), 1874);
state.token = config.usdt; save();
const status = await api(daemon, '/internal/mumbai/status');
assert.equal(status.tracks.whitechain.demo_settle, false); assert.equal(status.tracks.world.mock_proofs, false); assert.equal(status.tracks.arkiv.live, true);
check('Running platform uses live World configuration, real USDT receipts, and live Arkiv');
if (!state.buyer) { state.buyer = account.address; state.initial_usdt_units = String(await balance(account.address)); save(); }
assert.equal(state.buyer, account.address);
assert.ok(await rpc.getBalance({ address: account.address }) > parseEther('0.02'), 'Buyer needs WBT gas');
assert.ok(await balance(account.address) >= 200000n, 'Buyer needs at least 0.20 USDT');
if (!state.executor_gas_tx && await rpc.getBalance({ address: executor.address }) < parseEther('0.005')) {
  state.executor_gas_tx = await wallet.sendTransaction({ to: executor.address, value: parseEther('0.01') }); save();
}
if (state.executor_gas_tx) await wait(state.executor_gas_tx);
check('Mandate executor funded with testnet WBT for gas');
if (!state.mandate) {
  const terms = { owner: account.address.toLowerCase(), operator: executor.address.toLowerCase(), budgetPerWindow: '0.10', windowSeconds: 86400, lifetimeCap: '0.10', perPurchaseCap: '0.10', perSellerPct: 10000, maxDepth: 1, chainId: 1874 };
  const signature = await account.signMessage({ message: canonicalMandate(terms) });
  state.mandate = await api(policy, '/v1/mandates', { owner_address: terms.owner, operator_address: terms.operator, budget_per_window: terms.budgetPerWindow, window_seconds: terms.windowSeconds, lifetime_cap: terms.lifetimeCap, per_purchase_cap: terms.perPurchaseCap, per_seller_pct: terms.perSellerPct, max_depth: terms.maxDepth, chain_id: 1874, signature }, { 'idempotency-key': 'whitechain-live-2026-11-07-mandate-v1' }); save();
}
assert.ok(await rpc.getCode({ address: state.mandate.contract_address }));
assert.equal((await rpc.readContract({ address: state.mandate.contract_address, abi: parseAbi(['function usdc() view returns(address)']), functionName: 'usdc' })).toLowerCase(), config.usdt.toLowerCase(), 'Mandate token must match checkout token before sending funds');
check('Real Whitechain mandate deployed and worker registered in policy database');
if (await balance(state.mandate.contract_address) < 100000n) {
  if (!state.vault_funding_tx) { state.vault_funding_tx = await wallet.writeContract({ address: config.usdt, abi, functionName: 'transfer', args: [state.mandate.contract_address, 100000n] }); save(); }
  await wait(state.vault_funding_tx);
}
assert.equal(await balance(state.mandate.contract_address), 100000n);
check('Mandate vault holds exactly 0.10 real testnet USDT');
if (process.argv.includes('--prepare')) { console.log('READY worker', state.mandate.root_agent_id); process.exit(0); }
assert.equal(env.BAGSEVEN_MCP_WORKER, state.mandate.root_agent_id, 'Update BAGSEVEN_MCP_WORKER and restart the platform before checkout');
if (!state.plan) {
 state.plan = (await api(daemon, '/v1/plans', { name: 'Whitechain real payment verification', feature: 'ocr', amount: '0.10', credits: '2', ttl_seconds: 86400, merchant_wallet: state.provider })).plan; save();
}
if (!state.checkout) { state.checkout = (await api(daemon, '/v1/checkout-sessions', { plan_id: state.plan.id, holder: `wallet:${account.address.toLowerCase()}` })).session; save(); }
if (!state.payment_tx) {
 state.provider_balance_before = String(await balance(state.provider)); save();
 state.payment_tx = await wallet.writeContract({ address: config.usdt, abi, functionName: 'transfer', args: [state.provider, 100000n] }); save();
}
const receipt = await wait(state.payment_tx); state.payment_block = String(receipt.blockNumber); save();
check('0.10 USDT transfer to the supplied provider confirmed on public Whitechain');
state.provider_balance_after = String(await balance(state.provider));
assert.ok(BigInt(state.provider_balance_after) - BigInt(state.provider_balance_before) >= 100000n);
check('Provider received the full 0.10 USDT');
const message = `Bagseven payment confirmation\nContext: checkout:${state.checkout.id}\nChain: 1874\nTransaction: ${state.payment_tx.toLowerCase()}`;
const payload = { payment_tx: state.payment_tx, customer_wallet: account.address, payment_signature: await account.signMessage({ message }) };
if (!state.paid) { state.paid = await api(daemon, `/v1/public/checkout/${state.checkout.id}/confirm`, payload); save(); }
assert.equal(state.paid.session.status, 'PAID'); assert.equal(state.paid.verification, 'verified');
assert.match(state.paid.grant.arkiv_entity_key, /^0x[0-9a-fA-F]+$/);
assert.equal(state.paid.grant.worker_id, state.mandate.root_agent_id);
check('Confirmed payment created a real Arkiv entitlement bound to the live worker');
const repeated = await api(daemon, `/v1/public/checkout/${state.checkout.id}/confirm`, payload);
assert.equal(repeated.already_paid, true); assert.equal(repeated.session.grant_id, state.paid.grant.id);
assert.equal(repeated.session.platform_fee_amount, '0.0001');
check('Checkout retry reused one grant and one separately billed 0.1% provider fee');
const access = await api(daemon, `/v1/check?feature=ocr&holder=${encodeURIComponent(state.paid.grant.holder)}`);
assert.equal(access.enabled, true); check('SDK entitlement check confirms access');
if (!state.paid_run) { state.paid_run = await api(daemon, '/internal/grants/paid-run', { grant_id: state.paid.grant.id, amount: '0.01', idempotency_key: 'live-whitechain-2026-11-07-paid-run', work: 'Real testnet checkout verification' }); save(); }
assert.equal(state.paid_run.dual_gate.mandate, 'ok'); assert.equal(state.paid_run.dual_gate.grant, 'ok');
check('Paid run passed real on-chain mandate and live Arkiv gates');
state.final_usdt_units = String(await balance(account.address));
state.total_usdt_used = formatUnits(BigInt(state.initial_usdt_units) - BigInt(state.final_usdt_units), 6);
assert.ok(BigInt(state.initial_usdt_units) - BigInt(state.final_usdt_units) <= 1000000n);
state.result = 'PASS'; state.finished_at = new Date().toISOString(); save();
console.log('PASS public testnet run; USDT used:', state.total_usdt_used, 'payment:', state.payment_tx);
