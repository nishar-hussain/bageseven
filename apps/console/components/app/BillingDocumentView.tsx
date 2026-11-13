'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import type { BillingDocument } from '../../lib/provider-billing';
import { PageHeader, SecondaryButton, StatusPill } from './ui';
import { billingDate, documentNumber } from './BillingWorkspace';
import styles from './billing.module.css';

export function BillingDocumentView({ id }: { id: string }) {
  const [document, setDocument] = useState<BillingDocument | null>(null);
  const [error, setError] = useState(''), [receipt, setReceipt] = useState(false);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void fetch('/api/billing-documents?id=' + encodeURIComponent(id), { cache: 'no-store', signal: controller.signal })
      .then(async res => { const data = await res.json(); if (!res.ok) throw Error(data.error); if (!controller.signal.aborted) setDocument(data.document); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load invoice.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  const paid = document?.status === 'PAID';
  const showingReceipt = receipt && paid;
  const currency = document?.terms.chainId === 43113 && document.terms.token?.toLowerCase() === '0x5425890298aed601595a70ab815c96711a31bc65' ? 'USDC' : 'stablecoin';
  const explorer = document?.terms.chainId === 43113 ? 'https://testnet.snowtrace.io/tx/' : document?.terms.chainId === 43114 ? 'https://snowtrace.io/tx/' : null;
  return <div className={styles.document}>
    <div className={styles.noPrint}><PageHeader title="Billing document" description="Original invoice terms and recorded payment evidence."
      action={<><SecondaryButton disabled={loading} onClick={() => setRevision(n => n + 1)}>Refresh</SecondaryButton><SecondaryButton disabled={!document || loading || Boolean(error)} onClick={() => window.print()}><Printer size={14} /> Print / save PDF</SecondaryButton></>} />
      <div className={styles.toolbar} style={{ marginTop: 24 }}>
        <nav aria-label="Billing document type" className={styles.tabs}>
          <button aria-pressed={!showingReceipt} onClick={() => setReceipt(false)}>Invoice</button>
          <button aria-pressed={showingReceipt} disabled={!paid} onClick={() => setReceipt(true)}>Payment receipt</button>
        </nav><Link href="/app/invoices" className={styles.action}>Back to invoices</Link>
      </div>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : loading ? <p role="status">Loading document…</p> : document ? <article className={styles.paper} data-billing-print>
      <div className={styles.documentHead}>
        <div><div className={styles.wordmark}><Image src="/icon.svg" width={30} height={30} alt="" />Bagseven</div><p className={styles.note} style={{ marginTop: 12 }}>Provider billing</p></div>
        <div><h2>{showingReceipt ? 'Payment receipt' : 'Invoice'}</h2><small>{documentNumber(document.id)}</small><div style={{ marginTop: 12 }}><StatusPill tone={paid ? 'good' : document.status === 'OPEN' ? 'warn' : 'neutral'}>{paid ? 'Paid' : document.status === 'OPEN' ? 'Awaiting payment' : document.status.toLowerCase()}</StatusPill></div></div>
      </div>
      <div className={styles.documentMeta}>
        <div><span>Issued by</span><strong>{document.provider_id}</strong><span style={{ marginTop: 12 }}>Provider payout wallet</span><strong>{document.terms.merchant}</strong></div>
        <div><span>Billed to · customer account</span><strong>{document.holder}</strong>{document.payer && <><span style={{ marginTop: 12 }}>Paying wallet</span><strong>{document.payer}</strong></>}</div>
        <div><span>Invoice issued · UTC</span><strong>{billingDate(document.created_at)}</strong></div>
        <div><span>{paid ? 'Payment recorded · UTC' : 'Checkout valid until · UTC'}</span><strong>{paid ? document.paid_recorded_at ? new Date(document.paid_recorded_at).toLocaleString(undefined, { timeZone: 'UTC' }) : 'Not recorded for this historical payment' : document.expires_at ? new Date(document.expires_at).toLocaleString(undefined, { timeZone: 'UTC' }) : 'See recurring authorization'}</strong></div>
      </div>
      <table><thead><tr><th scope="col">Description</th><th scope="col">Amount</th></tr></thead><tbody><tr>
        <td>{document.terms.planName}<small>{document.terms.kind === 'renewal' ? 'Recurring subscription renewal' : document.terms.kind === 'subscription' ? 'First subscription period · every 30 days' : 'One-time purchase'} · {document.terms.feature}</small>
          {document.terms.periodStart && <small>Service period: {billingDate(document.terms.periodStart)} – {billingDate(document.terms.periodEnd ?? null)} UTC</small>}</td>
        <td>{document.terms.amount} {currency}</td>
      </tr></tbody></table>
      <div className={styles.total}><span>{showingReceipt ? 'Amount received' : 'Invoice total'}</span><strong>{document.terms.amount} {currency}</strong></div>
      {!showingReceipt && <div className={styles.total} style={{ paddingTop: 0 }}><span>Payable through this invoice</span><span>{paid || ['VOID', 'EXPIRED'].includes(document.status) ? '0' : document.terms.amount} {currency}{['VOID', 'EXPIRED'].includes(document.status) ? ' · invoice closed' : ''}</span></div>}
      <div className={styles.evidence}>
        <strong>{document.terms.chainId === 43113 ? 'Avalanche Fuji testnet · test assets' : 'Avalanche · chain ' + document.terms.chainId}</strong><br />
        Token: <code>{document.terms.token ?? 'Not recorded for this historical invoice'}</code><br />
        {document.payment_tx ? <>Payment transaction: {explorer ? <a href={explorer + document.payment_tx} target="_blank" rel="noreferrer">{document.payment_tx}</a> : <code>{document.payment_tx}</code>}</> : 'No verified payment has been recorded.'}
      </div>
      <p className={styles.printNote}>Issued by the provider identified above, through Bagseven. Taxes have not been assessed. Payment recorded is the time evidence was saved, not the block timestamp. A receipt confirms payment; access fulfillment is tracked separately in Entitlements. Billing identities remain off-chain.</p>
    </article> : null}
  </div>;
}
