/** Creates and removes its own local test database; never deletes application rows. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ProviderGasManager, SubscriptionAbi } from '../packages/onchain/dist/index.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, parseTransaction } from 'viem';
import { MemoryGrantStore } from '../packages/entitlements/dist/index.js';
import { Subscriptions } from '../services/daemon/src/subscriptions.ts';
import { createDb } from '../packages/db/dist/index.js';
import { PostgresBillingStore } from '../services/daemon/src/billing-store.ts';
import { PostgresSubscriptionStore } from '../services/daemon/src/subscription-store.ts';
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Pool } = require('pg');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const configured = process.env.DATABASE_URL;
if (!configured) throw Error('DATABASE_URL is required');
const url = new URL(configured);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('This persistence test refuses non-local databases');
const name = `bagseven_subscription_test_${Date.now().toString(36)}`;
const admin = new Pool({ connectionString: configured });
let firstDb; let secondDb; let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  url.pathname = `/${name}`;
  firstDb = createDb({ connectionString: url.toString() });
  secondDb = createDb({ connectionString: url.toString() });
  await migrate(firstDb, { migrationsFolder: 'packages/db/drizzle' });
  const billing = new PostgresBillingStore(firstDb);
  const plan = await billing.createPlan({ provider_id: 'test-provider', feature: 'ocr', name: 'Persistence test',
    interval: 'month', amount: '1', credits: '5', merchant_wallet: `0x${'11'.repeat(20)}` });
  const checkout = await billing.createCheckout({ plan_id: plan.id, holder: 'test-holder' });
  const first = new PostgresSubscriptionStore(firstDb); const second = new PostgresSubscriptionStore(secondDb);
  const sub = { id: 'sub_test', checkoutId: checkout.id, holder: 'test-holder', providerId: 'test-provider', plan,
    chainId: 1874, contract: `0x${'22'.repeat(20)}`, key: `0x${'33'.repeat(32)}`, payer: `0x${'44'.repeat(20)}`,
    status: 'ACTIVE', paidThrough: 1800000000, failures: 0, nextAttemptAt: 1800000120, grantId: 'grant', paymentTx: `0x${'55'.repeat(32)}` };
  await first.save(sub);
  const period = { id: 'period_test', subscriptionId: sub.id, due: sub.paidThrough, stage: 'signed', hash: `0x${'66'.repeat(32)}`, raw: '0xcommitted' };
  await assert.rejects(first.lock(sub.id, async () => { await first.savePeriod(period); throw Error('simulated process failure'); }), /simulated/);
  assert.deepEqual(await second.period(period.id), period);
  console.log('PASS payment journal survives lock-transaction rollback and a new store/connection');
  let release; let acquired;
  const ready = new Promise(resolve => { acquired = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const held = first.lock(sub.id, async () => { acquired(); await gate; return 'first'; });
  try {
    await ready;
    let ran = false;
    const other = await second.lock(sub.id, async () => { ran = true; });
    assert.equal(other, undefined); assert.equal(ran, false);
  } finally { release(); await held; }
  assert.equal(await second.lock(sub.id, async () => 'recovered'), 'recovered');
  assert.deepEqual(await second.get(sub.id), sub);
  console.log('PASS PostgreSQL advisory lock excludes a second worker, releases after failure, and preserves subscription state');
  const owner = privateKeyToAccount(generatePrivateKey());
  const gasEnv = { PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32) };
  const gasA = new ProviderGasManager(firstDb, gasEnv), gasB = new ProviderGasManager(secondDb, gasEnv);
  const draft = await gasA.prepare(plan.provider_id, { owner: owner.address, subscriptions: true,
    whitechainBudget: '1', arkivBudget: '1', whitechainTxLimit: '0.1', arkivTxLimit: '0.1', expires: Date.now() + 90 * 86400000 });
  await gasA.authorize(plan.provider_id, await owner.signMessage({ message: draft.message }));
  await first.savePlan({ id: plan.id, providerId: plan.provider_id, chainId: 1874, contract: sub.contract, status: 'ready' });
  const accountA = await gasA.account(plan.provider_id, 'whitechain'), accountB = await gasB.account(plan.provider_id, 'whitechain');
  const dataA = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [sub.key, 1800000000n] });
  const dataB = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [`0x${'77'.repeat(32)}`, 1800000000n] });
  const tx = { chainId: 1874, type: 'legacy', nonce: 0, to: sub.contract, gas: 100000n, gasPrice: 1n };
  const contenders = await Promise.allSettled([accountA.signTransaction({ ...tx, data: dataA }), accountB.signTransaction({ ...tx, data: dataB })]);
  assert.equal(contenders.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(contenders.find(r => r.status === 'rejected').reason), /NONCE_BUSY/);
  const winningData = contenders[0].status === 'fulfilled' ? dataA : dataB;
  const winningRaw = contenders.find(r => r.status === 'fulfilled').value;
  // A restart/new nonce/changed fee must recover the exact original intent without another fee reservation.
  const before = (await gasA.status(plan.provider_id)).whitechain_reserved_wei;
  const replay = await accountB.signTransaction({ ...tx, nonce: 2, gasPrice: 2n, data: winningData });
  assert.equal(replay, winningRaw); assert.equal(parseTransaction(replay).nonce, 0);
  assert.equal((await gasB.status(plan.provider_id)).whitechain_reserved_wei, before);
  assert.equal(await gasB.signedSubscription(plan.provider_id, 1874, winningData, sub.contract), winningRaw);
  console.log('PASS separate PostgreSQL signer connections exclude conflicting nonces and recover exact signed intents without charging gas budgets twice');

  const orphan = { ...sub, grantId: '', status: 'RECONCILIATION_REQUIRED' };
  await first.save(orphan);
  const grants = new MemoryGrantStore(); let charges = 0;
  const chain = { payment: async () => ({ hash: orphan.paymentTx, paidAt: orphan.paidThrough - plan.ttl_seconds,
    paidThrough: orphan.paidThrough, period: 1, payer: orphan.payer }), signCharge: async () => { charges++; throw Error('must not renew'); } };
  await new Subscriptions(second, chain, grants, () => orphan.paidThrough - 60).process(orphan.id);
  const recovered = await second.get(orphan.id);
  assert.ok(recovered.grantId); assert.equal((await second.period(`${orphan.id}:initial`)).stage, 'complete');
  assert.equal((await grants.get(recovered.grantId)).payment_tx, orphan.paymentTx); assert.equal(charges, 0);
  console.log('PASS PostgreSQL restart recovers a subscription saved before its initial period journal and fulfills paid access without renewal');

} finally {
  await firstDb?.$client.end(); await secondDb?.$client.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
