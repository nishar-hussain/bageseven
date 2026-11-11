/** Isolated EVM verification: generated test wallets and a local faucet token only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import solc from 'solc';
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, keccak256, stringToHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SubscriptionAbi, SubscriptionBytecode, SubscriptionRuntime } from '../packages/onchain/dist/index.js';
import { MemoryGrantStore } from '../packages/entitlements/dist/index.js';
import { MemorySubscriptionStore } from '../services/daemon/src/subscription-store.ts';
import { Subscriptions } from '../services/daemon/src/subscriptions.ts';
import { WhitechainSubscriptionChain, subscriptionKey } from '../services/daemon/src/subscription-chain.ts';

const port = await new Promise(resolve => {
  const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const anvil = spawn('anvil', ['--port', String(port), '--chain-id', '1874', '--silent'], { stdio: ['ignore', 'ignore', 'pipe'] });
let childError = ''; anvil.stderr.on('data', chunk => { childError += chunk.toString(); });
const url = `http://127.0.0.1:${port}`;
const chain = defineChain({ id: 1874, name: 'Isolated test chain', nativeCurrency: { name: 'Test gas', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [url] } } });
const client = createPublicClient({ chain, transport: http(url, { retryCount: 0 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(url) });
const owner = privateKeyToAccount(generatePrivateKey()); const collector = privateKeyToAccount(generatePrivateKey()); const merchant = privateKeyToAccount(generatePrivateKey());
const wallet = account => createWalletClient({ account, chain, transport: http(url) });
const mineTx = async hash => { const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success'); return receipt; };
try {
  let ready = false;
  for (let i = 0; i < 40; i++) { try { await client.getChainId(); ready = true; break; } catch { if (anvil.exitCode !== null) throw Error(childError); await new Promise(r => setTimeout(r, 100)); } }
  assert.ok(ready, 'Local Anvil did not start');
  for (const account of [owner, collector, merchant]) await test.setBalance({ address: account.address, value: 100n * 10n ** 18n });
  const source = await readFile('scripts/contracts/LocalUSDC.sol', 'utf8');
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Token.sol': { content: source } }, settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const tokenArtifact = compiled.contracts['Token.sol'].LocalUSDC;
  const tokenReceipt = await mineTx(await wallet(owner).deployContract({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }));
  const token = tokenReceipt.contractAddress;
  await mineTx(await wallet(owner).writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'mint', args: [owner.address, 1000000000n] }));
  const amount = 10000000n; const length = 30n * 86400n;
  let sequence = 0;
  async function subscribed() {
    const receipt = await mineTx(await wallet(collector).deployContract({ abi: SubscriptionAbi, bytecode: SubscriptionBytecode,
      args: [token, merchant.address, collector.address, amount, length, keccak256(stringToHex(`plan${sequence}`))] }));
    const address = receipt.contractAddress; const checkout = `checkout${sequence++}`; const checkoutKey = keccak256(stringToHex(checkout));
    assert.equal(keccak256(await client.getCode({ address })), keccak256(SubscriptionRuntime));
    await mineTx(await wallet(owner).writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'approve', args: [address, amount * 12n] }));
    const payment = await mineTx(await wallet(owner).writeContract({ address, abi: SubscriptionAbi, functionName: 'subscribe', args: [checkoutKey, (await client.getBlock()).timestamp + 3600n] }));
    const key = subscriptionKey(owner.address, checkout);
    const state = () => client.readContract({ address, abi: SubscriptionAbi, functionName: 'subscriptions', args: [key] });
    return { address, checkout, key, state, payment };
  }
  const balance = () => client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [merchant.address] });
  const first = await subscribed();
  assert.equal(await balance(), amount);
  const [, due] = await first.state();
  await assert.rejects(client.simulateContract({ address: first.address, abi: SubscriptionAbi, functionName: 'charge', account: collector, args: [first.key, due] }), /NotDue/);
  await test.setNextBlockTimestamp({ timestamp: due }); await test.mine({ blocks: 1 });
  await assert.rejects(client.simulateContract({ address: first.address, abi: SubscriptionAbi, functionName: 'charge', account: merchant, args: [first.key, due] }), /OwnerOnly/);
  await mineTx(await wallet(collector).writeContract({ address: first.address, abi: SubscriptionAbi, functionName: 'charge', args: [first.key, due] }));
  assert.equal(await balance(), amount * 2n);
  await assert.rejects(client.simulateContract({ address: first.address, abi: SubscriptionAbi, functionName: 'charge', account: collector, args: [first.key, due] }), /PeriodChanged/);
  console.log('PASS first payment, fixed recipient/amount, early-charge denial, collector scope, and duplicate/replayed period denial');

  const revoked = await subscribed(); const [, revokedDue] = await revoked.state();
  await mineTx(await wallet(owner).writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'approve', args: [revoked.address, 0n] }));
  await test.setNextBlockTimestamp({ timestamp: revokedDue }); await test.mine({ blocks: 1 });
  const before = await balance();
  await assert.rejects(client.simulateContract({ address: revoked.address, abi: SubscriptionAbi, functionName: 'charge', account: collector, args: [revoked.key, revokedDue] }), /AllowanceRequired/);
  assert.equal(await balance(), before);
  await mineTx(await wallet(owner).writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'approve', args: [revoked.address, amount] }));
  await mineTx(await wallet(collector).writeContract({ address: revoked.address, abi: SubscriptionAbi, functionName: 'charge', args: [revoked.key, revokedDue] }));
  console.log('PASS revoked allowance takes nothing; explicit reauthorization allows the due payment');

  const cancelled = await subscribed(); const [, cancelledDue] = await cancelled.state();
  await assert.rejects(client.simulateContract({ address: cancelled.address, abi: SubscriptionAbi, functionName: 'cancel', account: merchant, args: [cancelled.key] }), /OwnerOnly/);
  await mineTx(await wallet(owner).writeContract({ address: cancelled.address, abi: SubscriptionAbi, functionName: 'cancel', args: [cancelled.key] }));
  assert.equal((await cancelled.state())[1], cancelledDue);
  await test.setNextBlockTimestamp({ timestamp: cancelledDue }); await test.mine({ blocks: 1 });
  await assert.rejects(client.simulateContract({ address: cancelled.address, abi: SubscriptionAbi, functionName: 'charge', account: collector, args: [cancelled.key, cancelledDue] }), /Inactive/);
  console.log('PASS owner-only cancellation stops collections and preserves the paid-through timestamp');

  const expired = await subscribed(); const [, expiredDue] = await expired.state();
  await test.setNextBlockTimestamp({ timestamp: expiredDue + 86701n }); await test.mine({ blocks: 1 });
  await assert.rejects(client.simulateContract({ address: expired.address, abi: SubscriptionAbi, functionName: 'charge', account: collector, args: [expired.key, expiredDue] }), /CollectionWindowClosed/);
  console.log('PASS missed collection window cannot be back-billed');

  // Exercise the actual RPC adapter against the compiled contract, not a mocked receipt.
  const adapter = new WhitechainSubscriptionChain({ signedSubscription: async () => undefined, status: async () => ({ authorization: { subscriptions: true } }), account: async () => collector }, {
    CHAIN_ID: '1874', WHITECHAIN_RPC_URL: url, RPC_URL: url, WHITECHAIN_USDT: token, WHITECHAIN_CONFIRMATIONS: '1',
  });
  const plan = { id: 'adapter-plan', provider_id: 'provider', interval: 'month', ttl_seconds: Number(length), amount: '10', merchant_wallet: merchant.address };
  const prepared = await adapter.preparePlan(plan);
  await adapter.broadcast(prepared.raw);
  await mineTx(prepared.hash);
  assert.equal(await adapter.verifyPlan(prepared, plan), true);
  console.log('PASS provider-signed plan deployment, committed raw transaction broadcast and runtime/term verification via actual RPC adapter');
  const store = new MemorySubscriptionStore(); const grants = new MemoryGrantStore();
  await store.savePlan({ ...prepared, status: 'ready' });
  const fullPlan = { ...plan, name: 'Integration Pro', feature: 'ocr', credits: '5', active: true, created_at: new Date().toISOString() };
  const checkout = 'integration-checkout'; const key = subscriptionKey(owner.address, checkout);
  await mineTx(await wallet(owner).writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'approve', args: [prepared.contract, amount * 12n] }));
  const firstHash = await wallet(owner).writeContract({ address: prepared.contract, abi: SubscriptionAbi, functionName: 'subscribe', args: [keccak256(stringToHex(checkout)), (await client.getBlock()).timestamp + 3600n] });
  await mineTx(firstHash);
  let clock = Number((await client.getBlock()).timestamp);
  const service = new Subscriptions(store, adapter, grants, () => clock);
  const session = { id: checkout, holder: 'integration-human', plan_id: plan.id, plan: fullPlan, chain_id: 1874, status: 'PENDING', amount: '10', expires_at: new Date((clock + 3600) * 1000).toISOString() };
  const grant = await service.completeCheckout(session, owner.address, firstHash);
  const again = await service.completeCheckout(session, owner.address, firstHash);
  assert.equal(grant.id, again.id);
  let sub = await store.get(`sub_${checkout}`);
  assert.equal(sub.status, 'ACTIVE'); assert.equal(grant.remaining, '5');
  await test.setNextBlockTimestamp({ timestamp: BigInt(sub.paidThrough + 120) }); await test.mine({ blocks: 1 });
  clock = Number((await client.getBlock()).timestamp);
  await service.process(sub.id);
  const journal = await store.period(`${sub.id}:${sub.paidThrough}`);
  await mineTx(journal.hash);
  // A brand-new service instance recovers the committed transaction and fulfills the period.
  await new Subscriptions(store, adapter, grants, () => clock).process(sub.id);
  const renewed = await store.get(sub.id);
  assert.equal(renewed.paidThrough, sub.paidThrough + Number(length));
  assert.notEqual(renewed.grantId, grant.id);
  assert.equal((await grants.get(renewed.grantId)).remaining, '5');
  assert.equal((await adapter.state(renewed)).payments, 2);
  await mineTx(await wallet(owner).writeContract({ address: prepared.contract, abi: SubscriptionAbi, functionName: 'cancel', args: [key] }));
  await service.syncCancellation(renewed);
  assert.equal((await store.get(sub.id)).status, 'CANCELLED');
  assert.equal((await grants.get(renewed.grantId)).renewal_enabled, false);
  console.log('PASS actual first payment -> idempotent grant -> due renewal -> restarted worker -> renewed grant -> owner cancellation with paid access preserved');

} finally {
  anvil.kill('SIGTERM');
  await new Promise(resolve => { if (anvil.exitCode !== null) resolve(); else anvil.once('exit', resolve); });
}
