import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export type BillingDocumentTerms = {
  planId: string; planName: string; feature: string; amount: string;
  chainId: number; token: string | null; merchant: string;
  kind: 'once' | 'subscription' | 'renewal';
  periodStart?: string; periodEnd?: string;
};
type Executor = Pick<Database, 'execute'>;
export const billingDocumentId = (source: string) => `inv_${createHash('md5').update(source).digest('hex')}`;

/** Call inside the same transaction as the checkout/collection journal write. */
export async function issueBillingDocument(db: Executor, input: {
  source: string; provider: string; holder: string; terms: BillingDocumentTerms;
  createdAt?: Date; expiresAt?: Date;
}) {
  const id = billingDocumentId(input.source);
  await db.execute(sql`insert into billing_documents(id,source,provider_id,holder,terms,created_at,expires_at)
    values(${id},${input.source},${input.provider},${input.holder},${JSON.stringify(input.terms)}::jsonb,
      ${input.createdAt ?? new Date()},${input.expiresAt ?? null})
    on conflict(source) do nothing`);
  return id;
}

/** Signed/submitted bytes are not payment evidence. Only verified callers use this. */
export async function recordDocumentPayment(db: Executor, source: string, hash: string, payer: string) {
  const result = await db.execute(sql`update billing_documents set status='PAID',
    payment_tx=${hash.toLowerCase()},payer=${payer.toLowerCase()},paid_recorded_at=coalesce(paid_recorded_at,now())
    where source=${source} and (payment_tx is null or payment_tx=${hash.toLowerCase()})
      and (payer is null or payer=${payer.toLowerCase()}) returning id`);
  if (!result.rows.length) throw Error('BILLING_DOCUMENT_PAYMENT_CONFLICT');
}
