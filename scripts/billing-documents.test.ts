import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createDb, billingDocumentId } from '@bagseven/db';
import { PostgresBillingStore } from '../services/daemon/src/billing-store.js';
import { PostgresSubscriptionStore } from '../services/daemon/src/subscription-store.js';
import { billingDocument, documentList, customerDirectory } from '../apps/console/lib/provider-billing.js';
import type { Subscription } from '../services/daemon/src/subscription-types.js';

const url = process.env.BILLING_TEST_DATABASE_URL;
describe.skipIf(!url)('durable customer invoices (isolated PostgreSQL schema)', () => {
  const schema = 'billing_test_' + randomUUID().replaceAll('-', '');
  let admin: ReturnType<typeof createDb>, db: ReturnType<typeof createDb>, billing: PostgresBillingStore;
  beforeAll(async () => {
    vi.stubEnv('DEV_MODE', 'true');
    vi.stubEnv('AVALANCHE_USDC', '0x5425890298aed601595a70AB815c96711a31Bc65');
    vi.stubEnv('AVALANCHE_CHAIN_ID', '43113');
    vi.stubEnv('AVALANCHE_NETWORK', 'fuji');
    admin = createDb({ connectionString: url! });
    await admin.$client.query('create schema ' + schema);
    const isolated = new URL(url!); isolated.searchParams.set('options', '-c search_path=' + schema);
    db = createDb({ connectionString: isolated.toString() });
    const journal = JSON.parse(await readFile(new URL('../packages/db/drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    for (const entry of journal.entries) {
      const migration = await readFile(new URL('../packages/db/drizzle/' + entry.tag + '.sql', import.meta.url), 'utf8');
      // Original migrations qualify enum types with public; isolate those too.
      for (const statement of migration.replaceAll('"public".', '"' + schema + '".').split('--> statement-breakpoint')) await db.$client.query(statement);
    }
    billing = new PostgresBillingStore(db);
  }, 30000);
  afterAll(async () => {
    await db?.$client.end();
    if (admin) { await admin.$client.query('drop schema if exists ' + schema + ' cascade'); await admin.$client.end(); }
    vi.unstubAllEnvs();
  });
  it('keeps checkout creation atomic when the invoice cannot be saved', async () => {
    const plan = await billing.createPlan({ provider_id: 'atomic', name: 'One time', feature: 'ocr', amount: '1', merchant_wallet: '0x' + '11'.repeat(20) });
    await db.$client.query("create function reject_invoice() returns trigger language plpgsql as 'begin raise exception ''test invoice failure''; end'; create trigger reject_invoice before insert on billing_documents for each row execute function reject_invoice()");
    try {
      await expect(billing.createCheckout({ plan_id: plan.id, holder: 'buyer' })).rejects.toMatchObject({ cause: { message: 'test invoice failure' } });
      expect((await db.$client.query('select id from checkout_sessions where plan_id=$1', [plan.id])).rowCount).toBe(0);
    } finally { await db.$client.query('drop trigger reject_invoice on billing_documents; drop function reject_invoice()'); }
  });
  it('records a verified one-time payment independently of unfinished entitlement fulfillment', async () => {
    const plan = await billing.createPlan({ provider_id: 'once-provider', name: 'Scan credits', feature: 'ocr', amount: '1', merchant_wallet: '0x' + '11'.repeat(20) });
    const session = await billing.createCheckout({ plan_id: plan.id, holder: 'one-time-buyer' });
    const hash = '0x' + 'ab'.repeat(32), payer = '0x' + '12'.repeat(20);
    await billing.claimPayment(hash, session.id, payer);
    const id = billingDocumentId('checkout:' + session.id);
    const receipt = await billingDocument(db, 'one-time-buyer', id);
    expect(receipt).toMatchObject({ status: 'PAID', payment_tx: hash, payer });
    expect((await billing.getCheckout(session.id))?.status).toBe('PENDING');
    await billing.claimPayment(hash, session.id, payer);
    expect((await documentList(db, 'once-provider', 'issued', 'ALL', '', 0)).total).toBe(1);
    await expect(billing.claimPayment(hash, session.id, '0x' + '34'.repeat(20))).rejects.toThrow('BILLING_DOCUMENT_PAYMENT_CONFLICT');
    expect((await billingDocument(db, 'one-time-buyer', id))?.paid_recorded_at).toEqual(receipt?.paid_recorded_at);
  });
  it('preserves original terms, deduplicates first-period receipts, and records each renewal exactly once', async () => {
    const plan = await billing.createPlan({ provider_id: 'provider-a', name: 'Monthly', feature: 'ocr', amount: '10', interval: 'month', ttl_seconds: 2592000, merchant_wallet: '0x' + '22'.repeat(20) });
    const session = await billing.createCheckout({ plan_id: plan.id, holder: 'buyer@example.com' });
    const id = billingDocumentId('checkout:' + session.id);
    expect((await billingDocument(db, 'provider-a', id))?.status).toBe('OPEN');
    const subs = new PostgresSubscriptionStore(db), now = Math.floor(Date.now() / 1000);
    const payer = '0x' + '33'.repeat(20), initialHash = '0x' + '44'.repeat(32), hash = '0x' + '55'.repeat(32);
    const sub: Subscription = { id: 'sub_test', checkoutId: session.id, holder: session.holder, providerId: 'provider-a', plan,
      chainId: 43113, contract: '0x' + '66'.repeat(20), key: '0x' + '77'.repeat(32), payer,
      status: 'ACTIVE', paidThrough: now, nextAttemptAt: now, failures: 0, grantId: 'grant', paymentTx: initialHash };
    await subs.save(sub);
    await subs.savePeriod({ id: sub.id + ':initial', subscriptionId: sub.id, due: now - 2592000, stage: 'confirmed', hash: initialHash, raw: '', paidThrough: now });
    expect((await documentList(db, 'provider-a', 'issued', 'ALL', '', 0)).total).toBe(1);
    expect((await billingDocument(db, session.holder, id))?.status).toBe('PAID');
    const period = { id: sub.id + ':' + now, subscriptionId: sub.id, due: now, stage: 'signed' as const, hash, raw: 'signed-bytes' };
    await subs.savePeriod(period);
    const renewalId = billingDocumentId('period:' + period.id);
    expect((await billingDocument(db, 'provider-a', renewalId))?.status).toBe('OPEN');
    await db.$client.query("update billing_plans set name='Changed',amount='99' where id=$1", [plan.id]);
    await Promise.all([1, 2].map(() => subs.savePeriod({ ...period, stage: 'complete', paidThrough: now + 2592000 })));
    const receipt = await billingDocument(db, session.holder, renewalId);
    expect(receipt?.status).toBe('PAID');
    expect(receipt?.terms).toMatchObject({ amount: '10', planName: 'Monthly', token: '0x5425890298aed601595a70AB815c96711a31Bc65' });
    await expect(subs.savePeriod({ ...period, stage: 'confirmed', hash: '0x' + '88'.repeat(32) })).rejects.toThrow('BILLING_DOCUMENT_PAYMENT_CONFLICT');
    expect((await subs.period(period.id))?.hash).toBe(hash);
    expect((await documentList(db, 'provider-a', 'issued', 'PAID', '', 0)).total).toBe(2);
    expect((await documentList(db, session.holder, 'purchases', 'ALL', '', 0)).total).toBe(2);
    expect((await customerDirectory(db, 'provider-a', '', 0)).customers[0]).toMatchObject({ holder: session.holder, payments: 2, active_subscriptions: 1 });
    expect((await customerDirectory(db, 'provider-a', '%', 0)).total).toBe(0);
    expect((await documentList(db, 'foreign-provider', 'issued', 'ALL', session.holder, 0)).total).toBe(0);
    expect(await billingDocument(db, 'foreign-provider', renewalId)).toBeNull();
    expect(await billingDocument(db, 'another-buyer', renewalId)).toBeNull();
  });
});
