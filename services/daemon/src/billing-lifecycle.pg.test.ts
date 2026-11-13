import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, issueBillingDocument, recordDocumentPayment } from '@bagseven/db';
import { PostgresReceiptDeliveryStore, expireCheckouts } from './billing-lifecycle.js';
import { PostgresBillingStore } from './billing-store.js';
const connectionString = process.env.BILLING_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite('PostgreSQL billing lifecycle in an isolated schema', () => {
  const schema = 'billing_test_' + randomUUID().replaceAll('-', '');
  let admin: ReturnType<typeof createDb>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    admin = createDb({ connectionString: connectionString! });
    await admin.$client.query(`create schema "${schema}"`);
    const url = new URL(connectionString!); url.searchParams.set('options', '-csearch_path=' + schema);
    db = createDb({ connectionString: url.href });
    for (const table of ['billing_plans', 'checkout_sessions', 'billing_documents', 'billing_email_deliveries', 'billing_subscriptions'])
      await db.$client.query(`create table ${table} (like public.${table} including all)`);
  });
  afterAll(async () => { await db?.$client.end(); if (admin) { await admin.$client.query(`drop schema "${schema}" cascade`); await admin.$client.end(); } });
  const terms = { planId: 'test-plan', planName: 'Test plan', feature: 'ocr', amount: '1', chainId: 43113,
    token: '0x5425890298aed601595a70AB815c96711a31Bc65', merchant: '0x' + '2'.repeat(40), kind: 'once' as const };
  it('queues one receipt atomically and fences simultaneous workers and stale acknowledgements', async () => {
    const source = 'checkout:atomic';
    const id = await db.transaction(async tx => { const id = await issueBillingDocument(tx, { source, provider: 'provider', holder: 'customer', billingEmail: 'customer@example.com', terms }); await recordDocumentPayment(tx, source, '0x' + 'a'.repeat(64), '0x' + '1'.repeat(40)); return id; });
    await db.transaction(tx => recordDocumentPayment(tx, source, '0x' + 'a'.repeat(64), '0x' + '1'.repeat(40)));
    expect(Number((await db.$client.query('select count(*) from billing_email_deliveries')).rows[0].count)).toBe(1);
    const store = new PostgresReceiptDeliveryStore(db), one = randomUUID(), two = randomUUID();
    const claims = await Promise.all([store.claim(one), store.claim(two)]);
    expect(claims.flat()).toHaveLength(1);
    const lease = claims[0].length ? one : two;
    await store.sent(id, randomUUID(), 'stale');
    expect((await db.$client.query('select status from billing_email_deliveries where document_id=$1', [id])).rows[0].status).toBe('SENDING');
    await store.sent(id, lease, 'accepted');
    expect(await store.claim(randomUUID())).toEqual([]);
  });
  it('requires reconciliation rather than resending beyond the provider idempotency window', async () => {
    const source = 'checkout:uncertain';
    const id = await db.transaction(async tx => { const id = await issueBillingDocument(tx, { source, provider: 'provider', holder: 'customer', billingEmail: 'customer@example.com', terms }); await recordDocumentPayment(tx, source, '0x' + 'b'.repeat(64), '0x' + '1'.repeat(40)); return id; });
    await db.$client.query("update billing_email_deliveries set first_attempt_at=now()-interval '25 hours',status='SENDING',lease_until=now()-interval '1 minute' where document_id=$1", [id]);
    expect(await new PostgresReceiptDeliveryStore(db).claim(randomUUID())).toEqual([]);
    expect((await db.$client.query('select status from billing_email_deliveries where document_id=$1', [id])).rows[0].status).toBe('RECONCILIATION_REQUIRED');
  });
  it('reuses a single checkout under concurrency and does not extend its deadline', async () => {
    const store = new PostgresBillingStore(db);
    const plan = await store.createPlan({ name: 'Concurrent checkout', feature: 'ocr', amount: '1', merchant_wallet: terms.merchant });
    const results = await Promise.all(Array.from({ length: 16 }, () => store.createCheckout({ plan_id: plan.id, holder: 'concurrent-customer', billing_email: 'customer@example.com' })));
    expect(new Set(results.map(s => s.id)).size).toBe(1);
    expect(new Set(results.map(s => s.expires_at)).size).toBe(1);
    await db.$client.query("update checkout_sessions set expires_at=now()-interval '1 second' where id=$1", [results[0].id]);
    expect((await store.createCheckout({ plan_id: plan.id, holder: 'concurrent-customer', billing_email: 'customer@example.com' })).id).not.toBe(results[0].id);
  });
  it('expires recent drafts and removes only old unpaid unreferenced sessions', async () => {
    for (const [id, paid] of [['abandoned', false], ['recorded-payment', true]] as const) {
      await db.$client.query("insert into checkout_sessions(id,plan_id,holder,status,amount,expires_at,payment_tx) values($1,'test-plan','customer','PENDING','1',now()-interval '31 days',$2)", [id, paid ? '0x' + 'c'.repeat(64) : null]);
      await issueBillingDocument(db, { source: 'checkout:' + id, provider: 'provider', holder: 'customer', terms });
    }
    await expireCheckouts(db);
    expect((await db.$client.query("select id from checkout_sessions where id='abandoned'")).rows).toEqual([]);
    expect((await db.$client.query("select status from checkout_sessions where id='recorded-payment'")).rows[0].status).toBe('EXPIRED');
    expect((await db.$client.query("select id from billing_documents where source='checkout:abandoned'")).rows).toEqual([]);
  });
});
