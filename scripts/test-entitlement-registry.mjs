/** Isolated local-EVM verification: no public RPC, email, or external funds. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EntitlementRegistryAbi as abi, EntitlementRegistryBytecode } from '../packages/onchain/dist/index.js';

const node = spawn('anvil', ['--port', '18549', '--chain-id', '43113', '--silent'], { stdio: ['ignore', 'pipe', 'pipe'] });
const url = 'http://127.0.0.1:18549';
const client = createPublicClient({ transport: http(url, { retryCount: 0 }) });
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet = createWalletClient({ account, transport: http(url) });
const hash = value => keccak256(stringToHex(value));
const units = 10n ** 18n;
let processError;
node.on('error', error => { processError = error; });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (processError) throw processError;
    try { await client.getChainId(); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, 'Local EVM did not start');
  const deployed = await wallet.deployContract({ chain: null, abi, bytecode: EntitlementRegistryBytecode });
  const registry = (await client.waitForTransactionReceipt({ hash: deployed })).contractAddress;
  const write = async (functionName, args) => {
    const tx = await wallet.writeContract({ chain: null, address: registry, abi, functionName, args });
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, 'success');
  };
  const read = (functionName, args) => client.readContract({ address: registry, abi, functionName, args });
  const id = hash('grant'), holder = hash('private-account-subject'), feature = hash('ocr');
  const tip = await client.getBlock();
  await write('issue', [id, account.address, holder, feature, 5n * units, tip.timestamp + 3600n, true]);
  await write('consume', [id, units, hash('request-one')]);
  await write('consume', [id, units, hash('request-one')]);
  assert.equal((await read('grants', [id]))[3], 4n * units);
  await assert.rejects(write('consume', [id, 2n * units, hash('request-one')]));
  await write('hold', [id, 2n * units, hash('hold-one')]);
  await write('hold', [id, 2n * units, hash('hold-one')]);
  assert.equal((await read('grants', [id]))[3], 2n * units);
  await write('finalizeHold', [hash('hold-one'), true]);
  await write('finalizeHold', [hash('hold-one'), true]);
  assert.equal((await read('grants', [id]))[3], 4n * units);
  await assert.rejects(write('finalizeHold', [hash('hold-one'), false]));
  await write('hold', [id, units, hash('hold-two')]);
  await write('finalizeHold', [hash('hold-two'), false]);
  await write('finalizeHold', [hash('hold-two'), false]);
  assert.equal((await read('grants', [id]))[3], 3n * units);
  await write('cancelRenewal', [id]);
  const grant = await read('grants', [id]);
  assert.equal(grant[5], false);
  assert.equal(grant[4], tip.timestamp + 3600n);
  assert.equal(await read('isLive', [id]), true);
  await assert.rejects(write('consume', [id, 4n * units, hash('overspend')]));
  await client.request({ method: 'evm_increaseTime', params: [3601] });
  await client.request({ method: 'evm_mine', params: [] });
  assert.equal(await read('isLive', [id]), false);
  await assert.rejects(write('consume', [id, units, hash('expired')]));
  console.log('PASS registry: mint, consume retry, conflicting retry, hold, commit, release, overspend, expiry, cancellation preserves paid access');
  if (process.env.BAGSEVEN_REGISTRY_TEST_DATABASE_URL) {
    const databaseUrl = new URL(process.env.BAGSEVEN_REGISTRY_TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname) && databaseUrl.pathname.includes('_test'), 'Requires an isolated local test database');
    const { createDb } = await import('../packages/db/dist/index.js');
    const { ProviderGasManager } = await import('../packages/onchain/dist/index.js');
    const { AvalancheGrantStore, configureProviderGrantSigners } = await import('../packages/entitlements/dist/index.js');
    const db = createDb({ connectionString: databaseUrl.toString() });
    try {
      const env = { AVALANCHE_NETWORK: 'fuji', AVALANCHE_RPC_URL: url, CHAIN_ID: '43113',
        AVALANCHE_ENTITLEMENT_REGISTRY: registry, ENTITLEMENT_SUBJECT_SECRET: 'local-test-private-subject-secret',
        PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32), AVALANCHE_CONFIRMATIONS: '1' };
      const provider = `test-provider-${crypto.randomUUID()}@example.com`;
      const manager = new ProviderGasManager(db, env);
      const authorization = await manager.prepare(provider, { owner: account.address, avalancheBudget: '0.1', registryBudget: '0.1',
        avalancheTxLimit: '0.01', registryTxLimit: '0.01', expires: Date.now() + 90 * 86400000 });
      await manager.authorize(provider, await account.signMessage({ message: authorization.message }));
      await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ chain: null, to: authorization.authorization.address, value: parseEther('0.5') }) });
      configureProviderGrantSigners(id => manager.account(id, 'registry'));
      let store = new AvalancheGrantStore(db, env);
      const input = { id: crypto.randomUUID(), merchant: provider, holder: 'customer@example.com', feature: 'ocr', remaining: '5', ttl_seconds: 86400, renewal_enabled: true, settlement_network: 'avalanche' };
      const minted = await store.mint(input);
      assert.equal(minted.remaining, '5');
      assert.equal((await store.mint(input)).id, minted.id);
      const interruptedInput = { ...input, id: crypto.randomUUID(), payment_tx: `0x${'51'.repeat(32)}` };
      configureProviderGrantSigners(async id => {
        const signer = await manager.account(id, 'registry');
        return { ...signer, signTransaction: async (...args) => {
          await signer.signTransaction(...args);
          throw Error('simulated crash after durable signing before broadcast');
        } };
      });
      await assert.rejects(store.mint(interruptedInput), /simulated crash/);
      const reserved = (await manager.status(provider)).registry_reserved_wei;
      configureProviderGrantSigners(async () => { throw Error('Recovery must never request a fresh signer'); });
      store = new AvalancheGrantStore(db, env);
      await assert.rejects(store.recoverMint(interruptedInput.id, { ...interruptedInput, holder: 'wrong@example.com' }), /CONFLICT/);
      assert.equal((await store.recoverMint(interruptedInput.id, interruptedInput)).remaining, '5');
      assert.equal((await manager.status(provider)).registry_reserved_wei, reserved);
      console.log('PASS actual registry issue recovers exact signed bytes after restart without fresh signing or double fee reservation');
      configureProviderGrantSigners(id => manager.account(id, 'registry'));
      await store.consume(minted.id, '1', 'persisted-request');
      store = new AvalancheGrantStore(db, env);
      assert.equal((await store.consume(minted.id, '1', 'persisted-request')).remaining, '4');
      await assert.rejects(store.consume(minted.id, '2', 'persisted-request'), /IDEMPOTENCY_CONFLICT/);
      await assert.rejects(store.consume(minted.id, '99', 'overspend-adapter'), /GRANT_EMPTY/);
      const releasedHold = `${input.id}:released`, committedHold = `${input.id}:committed`;
      await store.hold(minted.id, '2', releasedHold);
      store = new AvalancheGrantStore(db, env);
      assert.equal((await store.get(minted.id)).remaining, '2');
      await store.release(releasedHold);
      assert.equal((await store.release(releasedHold)).remaining, '4');
      await store.hold(minted.id, '1', committedHold);
      await store.commit(committedHold);
      assert.equal((await store.commit(committedHold)).remaining, '3');
      const cancelled = await store.cancelRenewal(minted.id);
      assert.equal(cancelled.renewal_enabled, false);
      assert.equal(cancelled.paid_through, minted.paid_through);
      assert.equal((await store.findLive({ holder: input.holder, feature: input.feature })).some(g => g.id === minted.id), true);
      console.log('PASS registry adapter: provider-authorized AVAX signing, durable mint/consume/holds, restart recovery, direct contract reads and cancellation');
    } finally { await db.$client.end(); }
  }
} finally {
  node.kill('SIGTERM');
}
