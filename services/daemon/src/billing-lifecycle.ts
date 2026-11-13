import { randomUUID } from 'node:crypto';
import type { Database, BillingDocumentTerms } from '@bagseven/db';
import { billingDocumentUrl } from '@bagseven/db';
import { notifyConfigured, sendNotify, type NotifyPayload } from '@bagseven/notify';

export type ReceiptDelivery = {
  document_id: string; recipient: string; attempts: number; created_at: Date;
  first_attempt_at: Date; terms: BillingDocumentTerms; provider_id: string; payment_tx: string;
};
export interface ReceiptDeliveryStore {
  claim(lease: string): Promise<ReceiptDelivery[]>;
  sent(id: string, lease: string, messageId: string): Promise<void>;
  retry(id: string, lease: string): Promise<void>;
}

/** One immutable email payload per invoice keeps provider idempotency valid on retry. */
export function receiptEmail(job: ReceiptDelivery, env: NodeJS.ProcessEnv): NotifyPayload {
  const terms = job.terms;
  const symbol = terms.chainId === 43113 && terms.token?.toLowerCase() === '0x5425890298aed601595a70ab815c96711a31bc65' ? 'USDC' : terms.chainId === 43114 && terms.token?.toLowerCase() === '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e' ? 'USDC' : 'Configured token';
  return {
    to: job.recipient, event: 'billing_receipt', idempotencyKey: 'bagseven-receipt-' + job.document_id,
    subject: `Your ${terms.planName} receipt · ${terms.amount} ${symbol}`,
    title: 'Payment received',
    body: `Thank you. Your ${terms.planName} payment has been verified on Avalanche. Your invoice and payment receipt are ready. Access fulfillment is tracked separately in your account.`,
    href: billingDocumentUrl(env.CONSOLE_URL || 'http://localhost:3000', job.document_id, new Date(job.created_at), env.ENTITLEMENT_SUBJECT_SECRET || ''),
    actionLabel: 'View invoice & receipt',
    meta: { Provider: job.provider_id, Plan: terms.planName, Amount: `${terms.amount} ${symbol}`, Invoice: 'B7-' + job.document_id.slice(4).toUpperCase(),
      Billing: terms.kind === 'once' ? 'One-time purchase' : terms.kind === 'renewal' ? 'Subscription renewal' : 'First subscription period',
      Network: terms.chainId === 43113 ? 'Avalanche Fuji · test assets' : `Avalanche · ${terms.chainId}`, Transaction: job.payment_tx },
  };
}

export class ReceiptMailer {
  private running = false;
  constructor(private store: ReceiptDeliveryStore, private env: NodeJS.ProcessEnv,
    private send = sendNotify, private configured = notifyConfigured) {}
  async tick() {
    if (this.running || !this.configured()) return;
    this.running = true;
    try {
      const lease = randomUUID();
      for (const job of await this.store.claim(lease)) {
        try {
          const result = await this.send(receiptEmail(job, this.env));
          if (!result.ok || !result.id || result.skipped) throw Error('DELIVERY_NOT_ACCEPTED');
          await this.store.sent(job.document_id, lease, result.id);
        } catch { await this.store.retry(job.document_id, lease); }
      }
    } finally { this.running = false; }
  }
}

/** Bounded, lease-fenced work. Uncertain sends never retry beyond Resend's 24h idempotency window. */
export class PostgresReceiptDeliveryStore implements ReceiptDeliveryStore {
  constructor(private db: Database) {}
  async claim(lease: string): Promise<ReceiptDelivery[]> {
    await this.db.$client.query(`with stale as (select document_id from billing_email_deliveries where status in ('PENDING','SENDING') and first_attempt_at<now()-interval '23 hours' and (lease_until is null or lease_until<now()) order by first_attempt_at,document_id for update skip locked limit 100) update billing_email_deliveries set status='RECONCILIATION_REQUIRED',lease_id=null,lease_until=null,
      last_error='Delivery status needs provider reconciliation before another send' where document_id in(select document_id from stale)`);
    const result = await this.db.$client.query(`with due as (
      select document_id from billing_email_deliveries where status in ('PENDING','SENDING') and next_attempt_at<=now()
      and (lease_until is null or lease_until<now()) order by next_attempt_at,document_id for update skip locked limit 10
    ), claimed as (
      update billing_email_deliveries e set status='SENDING',lease_id=$1::uuid,lease_until=now()+interval '5 minutes',
        first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1 from due where e.document_id=due.document_id returning e.*
    ) select c.*,d.terms,d.provider_id,d.payment_tx from claimed c join billing_documents d on d.id=c.document_id and d.status='PAID'`, [lease]);
    return result.rows;
  }
  async sent(id: string, lease: string, messageId: string) {
    await this.db.$client.query(`update billing_email_deliveries set status='SENT',sent_at=now(),provider_message_id=$3,
      lease_until=null,lease_id=null,last_error=null where document_id=$1 and lease_id=$2::uuid`, [id, lease, messageId]);
  }
  async retry(id: string, lease: string) {
    await this.db.$client.query(`update billing_email_deliveries set status='PENDING',lease_until=null,lease_id=null,
      last_error='Email provider did not confirm acceptance; scheduled for retry',
      next_attempt_at=now()+least(3600,60*power(2,least(attempts,6))) * interval '1 second'
      where document_id=$1 and lease_id=$2::uuid`, [id, lease]);
  }
}

/** Expire sessions durably; purge only unpaid, unreferenced abandoned checkouts after 30 days. */
export async function expireCheckouts(db: Database) {
  await db.$client.query(`with due as (select id from checkout_sessions where status='PENDING' and expires_at<=now()
    order by expires_at,id for update skip locked limit 100)
    update checkout_sessions c set status='EXPIRED' from due where c.id=due.id`);
  const connection = await db.$client.connect();
  try {
    await connection.query('BEGIN');
    const result = await connection.query(`select c.id from checkout_sessions c where c.status='EXPIRED'
      and c.expires_at<now()-interval '30 days' and c.payment_tx is null and c.grant_id is null
      and not exists(select 1 from billing_subscriptions s where s.checkout_id=c.id)
      and not exists(select 1 from billing_documents d where d.source='checkout:'||c.id and d.status='PAID')
      order by c.expires_at,c.id for update skip locked limit 100`);
    const ids = result.rows.map(row => row.id);
    if (ids.length) {
      await connection.query(`delete from billing_documents where source=any(select 'checkout:'||unnest($1::text[])) and status<>'PAID'`, [ids]);
      await connection.query('delete from checkout_sessions where id=any($1::text[])', [ids]);
    }
    await connection.query('COMMIT');
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
  finally { connection.release(); }
}
