/** Creates and removes its own local test database; never deletes application rows. */
import assert from 'node:assert/strict';
import { providerOverview, providerCheckouts } from '../apps/console/lib/provider-overview.ts';
import { createRequire } from 'node:module';
import { ProviderGasManager, SubscriptionAbi } from '../packages/onchain/dist/index.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, parseTransaction } from 'viem';
import { MemoryGrantStore } from '../packages/entitlements/dist/index.js';
import { Subscriptions } from '../services/daemon/src/subscriptions.ts';
import { AccountProfiles, CredentialStore, EmbedDesignStore, createDb } from '../packages/db/dist/index.js';
import { PostgresBillingStore } from '../services/daemon/src/billing-store.ts';
import { PostgresSubscriptionStore } from '../services/daemon/src/subscription-store.ts';
import { configureFeatureDatabase, createFeature, getFeatureValueType } from '../services/daemon/src/feature-registry.ts';
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
  // Provider overview is business-scoped, not holder-scoped. Another provider's
  // sale to the same holder must not appear, while this provider's customers do.
  await firstDb.$client.query(`insert into billing_plans(id,provider_id,feature,name,amount,active,merchant_wallet) values
    ('overview-plan-a','overview-a','ocr','OCR pack','5','true','0x1111111111111111111111111111111111111111'),
    ('overview-plan-b','overview-b','ocr','Other provider','99','true','0x2222222222222222222222222222222222222222'),
    ('overview-old-a','overview-a','ocr','Archived','5','false','0x1111111111111111111111111111111111111111')`);
  await firstDb.$client.query(`insert into checkout_sessions(id,plan_id,holder,status,amount,expires_at,created_at) values
    ('overview-paid','overview-plan-a','customer-a','PAID','5',now()+interval '1 day',now()),
    ('overview-pending','overview-plan-a','customer-b','PENDING','5',now()+interval '1 day',now()),
    ('overview-expired','overview-plan-a','customer-c','PENDING','5',now()-interval '1 minute',now()),
    ('overview-foreign','overview-plan-b','overview-a','PAID','99',now()+interval '1 day',now()),
    ('overview-old','overview-plan-a','customer-a','PAID','5',now()-interval '40 days',now()-interval '40 days')`);
  await firstDb.$client.query(`insert into billing_subscriptions(id,checkout_id,holder,provider_id,status,next_attempt_at,data) values
    ('overview-sub','overview-paid','customer-a','overview-a','RECONCILIATION_REQUIRED',now(),'{"planId":"overview-plan-a"}')`);
  const overview = await providerOverview(firstDb, 'overview-a', 7);
  assert.equal(overview.metrics.paid, 1); assert.equal(overview.metrics.customers, 1);
  assert.equal(overview.metrics.checkouts, 3); assert.equal(overview.metrics.pending, 1);
  assert.equal(overview.metrics.expired, 1); assert.equal(overview.metrics.activePlans, 1);
  assert.equal(overview.metrics.reconciliation, 1); assert.equal(overview.subscriptions[0].plan, 'OCR pack');
  assert.equal(overview.activity.length, 7);
  assert.equal(overview.activity.reduce((n,d)=>n+d.opened,0),3);
  assert.equal(overview.activity.reduce((n,d)=>n+d.paid,0),1);
  assert.ok(overview.recent.every(r=>r.id!=='overview-foreign'&&r.id!=='overview-old'));
  assert.equal(overview.topPlans.length,1);
  const listed = await providerCheckouts(firstDb,'overview-a','ALL',0);
  assert.equal(listed.total,4); assert.ok(!listed.sessions.some(r=>r.id==='overview-foreign'));
  assert.equal((await providerCheckouts(firstDb,'overview-a','ALL',0,7)).total,3);
  assert.equal((await providerCheckouts(firstDb,'overview-a','PAID',0,7)).total,overview.metrics.paid);
  assert.equal((await providerCheckouts(firstDb,'overview-a','PENDING',0)).total,1);
  assert.equal((await providerCheckouts(firstDb,'overview-a','EXPIRED',0)).sessions[0].id,'overview-expired');
  assert.equal((await providerCheckouts(firstDb,'overview-a','ALL',1)).sessions.length,0);
  assert.equal((await providerOverview(firstDb,'unknown-provider',7)).metrics.checkouts,0);
  await firstDb.$client.query(`delete from billing_subscriptions where id='overview-sub'`);
  await firstDb.$client.query(`delete from checkout_sessions where id like 'overview-%'`);
  await firstDb.$client.query(`delete from billing_plans where id like 'overview-%'`);
  console.log('PASS provider overview scope, real cohort counts, expired sessions, per-day activity, issue links and paginated checkout isolation');

  const designsA = new EmbedDesignStore(firstDb), designsB = new EmbedDesignStore(secondDb);
  const initialDesign = await designsA.create('provider-a', { name: 'Billing', componentId: 'cmp_customer' });
  assert.equal((await designsB.list('provider-a'))[0].id, initialDesign.id);
  assert.equal((await designsB.list('provider-b')).length, 0);
  assert.equal(await designsB.published(initialDesign.id), undefined);
  await assert.rejects(designsB.change('provider-b', initialDesign.id, 1, 'publish'), /DESIGN_NOT_FOUND/);
  const edits = await Promise.allSettled([designsA, designsB].map((store, i) => store.change('provider-a', initialDesign.id, 1, 'save', { name: `Edit ${i}` })));
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
  let design = (await designsB.list('provider-a'))[0];
  design = await designsA.change('provider-a', design.id, design.revision, 'publish');
  const publishedName = (await designsB.published(design.id)).name;
  design = await designsB.change('provider-a', design.id, design.revision, 'save', { name: 'Unpublished edit' });
  assert.equal((await designsA.published(design.id)).name, publishedName);
  design = await designsA.change('provider-a', design.id, design.revision, 'unpublish');
  assert.equal(await designsB.published(design.id), undefined);
  await designsB.change('provider-a', design.id, design.revision, 'delete');
  assert.equal((await designsA.list('provider-a')).length, 0);
  console.log('PASS account-backed Builder drafts, provider isolation, concurrent edit protection and explicit publish/unpublish snapshots');
  const credentialsA = new CredentialStore(firstDb, 'integration-oauth');
  const credentialsB = new CredentialStore(secondDb, 'integration-oauth');
  await credentialsA.set('authorization-code', { exp: Date.now() + 60000, account: 'alice' });
  assert.equal((await credentialsB.get('authorization-code')).account, 'alice');
  const exchanges = await Promise.all([credentialsA, credentialsB].map((store, i) => store.exchange('authorization-code', [
    { key: `access-${i}`, data: { exp: Date.now() + 60000, account: 'alice' } },
  ])));
  assert.equal(exchanges.filter(Boolean).length, 1);
  assert.equal(await credentialsA.get('authorization-code'), undefined);
  await credentialsA.set('challenge', { exp: Date.now() + 60000, attempts: 0 });
  const attempts = await Promise.all(Array.from({ length: 10 }, () => credentialsB.attempt('challenge', 5)));
  assert.equal(attempts.filter(Boolean).length, 5);
  assert.deepEqual(attempts.filter(Boolean).map(v => v.attempts).sort(), [1,2,3,4,5]);
  const claims = await Promise.all([credentialsA, credentialsB].map(store => store.claim('email-rate', { exp: Date.now() + 60000 })));
  assert.equal(claims.filter(Boolean).length, 1);
  console.log('PASS durable OAuth state, atomic single-use exchange, shared consent attempts and cross-instance rate claims');
  const profilesA = new AccountProfiles(firstDb), profilesB = new AccountProfiles(secondDb);
  const email = 'durable-account@example.com';
  await profilesA.ensure(email);
  const wallets = [`0x${'a1'.repeat(20)}`, `0x${'b2'.repeat(20)}`];
  const binds = await Promise.allSettled(wallets.map(wallet => profilesA.bind(email, null, wallet)));
  assert.equal(binds.filter(b => b.status === 'fulfilled').length, 1);
  const profile = await profilesB.get(email);
  assert.ok(wallets.includes(profile.walletAddress));
  await profilesB.complete(email, profile.walletAddress, 1800000000);
  assert.equal((await profilesA.get(email)).onboardingDoneAt, 1800000000);
  await assert.rejects(profilesB.bind(email, null, wallets[1]), /ACCOUNT_CHANGED/);
  console.log('PASS durable account authority survives new connections; concurrent wallet bindings cannot overwrite each other');
  const billing = new PostgresBillingStore(firstDb);
  configureFeatureDatabase(firstDb);
  await createFeature({ id: 'durable_flag', value_type: 'boolean' });
  configureFeatureDatabase(secondDb);
  assert.equal(await getFeatureValueType('durable_flag'), 'boolean');
  await assert.rejects(createFeature({ id: 'durable_flag', value_type: 'numeric' }), /FEATURE_EXISTS/);
  console.log('PASS shared feature semantics survive independent database connections and cannot be overwritten');
  const plan = await billing.createPlan({ provider_id: 'test-provider', feature: 'ocr', name: 'Persistence test',
    interval: 'month', amount: '1', credits: '5', merchant_wallet: `0x${'11'.repeat(20)}` });
  const checkout = await billing.createCheckout({ plan_id: plan.id, holder: 'test-holder' });
  const first = new PostgresSubscriptionStore(firstDb); const second = new PostgresSubscriptionStore(secondDb);
  await first.savePlan({ id: plan.id, providerId: plan.provider_id, chainId: 43113, contract: `0x${'22'.repeat(20)}`, status: 'preparing' });
  assert.equal((await second.pendingPlans('', 1))[0]?.id, plan.id);
  assert.deepEqual(await second.pendingPlans(plan.id, 1), []);
  await first.savePlan({ id: plan.id, providerId: plan.provider_id, chainId: 43113, contract: `0x${'22'.repeat(20)}`, status: 'ready' });
  assert.deepEqual(await second.pendingPlans('', 1), []);
  console.log('PASS pending plan recovery uses status-filtered, bounded keyset pages');
  const sub = { id: 'sub_test', checkoutId: checkout.id, holder: 'test-holder', providerId: 'test-provider', plan,
    chainId: 43113, contract: `0x${'22'.repeat(20)}`, key: `0x${'33'.repeat(32)}`, payer: `0x${'44'.repeat(20)}`,
    status: 'ACTIVE', paidThrough: 1800000000, failures: 0, nextAttemptAt: 1800000120, grantId: 'grant', paymentTx: `0x${'55'.repeat(32)}` };
  await first.save(sub);
  assert.deepEqual(await second.due(sub.nextAttemptAt - 1, 100), []);
  assert.deepEqual((await second.due(sub.nextAttemptAt, 1)).map(s => s.id), [sub.id]);
  await first.save({ ...sub, status: 'RECONCILIATION_REQUIRED', nextAttemptAt: sub.nextAttemptAt + 60 });
  assert.deepEqual(await second.due(sub.nextAttemptAt, 100), []);
  await first.save({ ...sub, status: 'CANCELLED' });
  assert.deepEqual(await second.due(sub.nextAttemptAt, 100), []);
  await first.save({ ...sub, status: 'CANCELLED', lastError: 'RENEWAL_FLAG_SYNC_PENDING: retry' });
  assert.equal((await second.due(sub.nextAttemptAt, 1))[0]?.id, sub.id);
  await first.save(sub);
  console.log('PASS indexed due queries honor retry delays, batch limits, and cancellation synchronization');
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
    avalancheBudget: '1', registryBudget: '1', avalancheTxLimit: '0.1', registryTxLimit: '0.1', expires: Date.now() + 90 * 86400000 });
  await gasA.authorize(plan.provider_id, await owner.signMessage({ message: draft.message }));
  await first.savePlan({ id: plan.id, providerId: plan.provider_id, chainId: 43113, contract: sub.contract, status: 'ready' });
  const accountA = await gasA.account(plan.provider_id, 'avalanche'), accountB = await gasB.account(plan.provider_id, 'avalanche');
  const dataA = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [sub.key, 1800000000n] });
  const dataB = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [`0x${'77'.repeat(32)}`, 1800000000n] });
  const tx = { chainId: 43113, type: 'legacy', nonce: 0, to: sub.contract, gas: 100000n, gasPrice: 1n };
  const contenders = await Promise.allSettled([accountA.signTransaction({ ...tx, data: dataA }), accountB.signTransaction({ ...tx, data: dataB })]);
  assert.equal(contenders.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(contenders.find(r => r.status === 'rejected').reason), /NONCE_BUSY/);
  const winningData = contenders[0].status === 'fulfilled' ? dataA : dataB;
  const winningRaw = contenders.find(r => r.status === 'fulfilled').value;
  // A restart/new nonce/changed fee must recover the exact original intent without another fee reservation.
  const before = (await gasA.status(plan.provider_id)).avalanche_reserved_wei;
  const replay = await accountB.signTransaction({ ...tx, nonce: 2, gasPrice: 2n, data: winningData });
  assert.equal(replay, winningRaw); assert.equal(parseTransaction(replay).nonce, 0);
  assert.equal((await gasB.status(plan.provider_id)).avalanche_reserved_wei, before);
  assert.equal(await gasB.signedSubscription(plan.provider_id, 43113, winningData, sub.contract), winningRaw);
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
