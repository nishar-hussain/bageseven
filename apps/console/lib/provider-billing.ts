import { verifyBillingDocumentAccess } from '@bagseven/db';
import type { BillingDocumentTerms, Database } from '@bagseven/db';

export type BillingDocument = {
  id: string; provider_id: string; holder: string; terms: BillingDocumentTerms;
  email_delivery?: { status: string; sent_at: string | null; last_error: string | null } | null;
  status: 'OPEN' | 'PAID' | 'VOID' | 'EXPIRED'; created_at: string;
  expires_at: string | null; paid_recorded_at: string | null; payment_tx: string | null; payer: string | null;
};
export type Customer = { holder: string; invoices: number; payments: number; first_seen: string; last_seen: string; active_subscriptions: number };

async function query(db: Database, statement: string, values: unknown[]) {
  const connection = await db.$client.connect();
  try {
    await connection.query('BEGIN READ ONLY');
    await connection.query("SET LOCAL statement_timeout = '5s'");
    const result = await connection.query(statement, values);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}

export async function customerDirectory(db: Database, provider: string, search: string, page: number) {
  const result = await query(db, `with customers as (
    select holder,count(*)::int as invoices,count(*) filter(where status='PAID')::int as payments,
      min(created_at) as first_seen,max(created_at) as last_seen
    from billing_documents where status='PAID' and provider_id=$1 and position(lower($2) in lower(holder))>0 group by holder
  ), page as (
    select c.*,(select count(*)::int from billing_subscriptions s where s.provider_id=$1 and s.holder=c.holder and s.status='ACTIVE') as active_subscriptions
    from customers c order by last_seen desc,holder limit 20 offset $3
  ) select (select count(*)::int from customers) as total,
    coalesce((select jsonb_agg(to_jsonb(page) order by last_seen desc,holder) from page),'[]'::jsonb) as customers`, [provider, search, page * 20]);
  return result.rows[0] as { total: number; customers: Customer[] };
}

export async function documentList(db: Database, identity: string, view: 'issued' | 'purchases', status: string, customer: string, page: number) {
  // Column comes only from this allowlisted view, never a client identity.
  const scope = view === 'purchases' ? '(holder=$1 or billing_email=$1)' : 'provider_id=$1';
  const result = await query(db, `with scoped as (
    select id,provider_id,holder,terms,created_at,expires_at,paid_recorded_at,payment_tx,payer,
      case when status='OPEN' and expires_at<=now() then 'EXPIRED' else status end as status
    from billing_documents where (${scope}) and status='PAID' and ($2='' or holder=$2)
  ), filtered as (select * from scoped where $3='ALL' or status=$3),
  page as (select * from filtered order by created_at desc,id desc limit 20 offset $4)
  select (select count(*)::int from filtered) as total,
    coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb) as documents`,
  [identity, customer, status, page * 20]);
  return result.rows[0] as { total: number; documents: BillingDocument[] };
}

export async function billingDocument(db: Database, identity: string, id: string): Promise<BillingDocument | null> {
  const result = await query(db, `select id,provider_id,holder,terms,created_at,expires_at,paid_recorded_at,payment_tx,payer,
    (select jsonb_build_object('status',e.status,'sent_at',e.sent_at,'last_error',e.last_error) from billing_email_deliveries e where e.document_id=billing_documents.id) as email_delivery,
    case when status='OPEN' and expires_at<=now() then 'EXPIRED' else status end as status
    from billing_documents where id=$1 and (provider_id=$2 or holder=$2 or billing_email=$2)`, [id, identity]);
  return result.rows[0] ?? null;
}

/** Only this verified document capability permits an unauthenticated invoice read. */
export async function sharedBillingDocument(db: Database, id: string, access: string, secret: string): Promise<BillingDocument | null> {
  if (!verifyBillingDocumentAccess(id, access, secret)) return null;
  const result = await query(db, `select id,provider_id,holder,terms,status,created_at,expires_at,paid_recorded_at,payment_tx,payer
    from billing_documents where id=$1 and status='PAID'`, [id]);
  return result.rows[0] ?? null;
}
