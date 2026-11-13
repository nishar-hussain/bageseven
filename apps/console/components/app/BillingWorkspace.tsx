'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Search, UsersRound, ArrowUpRight } from 'lucide-react';
import { PageHeader, SecondaryButton, SoftCard, StatusPill } from './ui';
import type { BillingDocument, Customer } from '../../lib/provider-billing';
import styles from './billing.module.css';

export const documentNumber = (id: string) => 'B7-' + id.slice(4).toUpperCase();
export const billingDate = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Not recorded';
export function BillingWorkspace({ kind }: { kind: 'customers' | 'invoices' }) {
  const params = useSearchParams(), router = useRouter();
  const view = params.get('view') === 'purchases' ? 'purchases' : 'issued';
  const status = params.get('status') ?? 'ALL', customer = params.get('customer') ?? '';
  const search = params.get('search') ?? '';
  const [query, setQuery] = useState(search);
  const [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<{ total: number; customers?: Customer[]; documents?: BillingDocument[] } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const qs = new URLSearchParams({ page: String(page), search, view, status, customer });
    void fetch('/api/' + (kind === 'customers' ? 'customers' : 'billing-documents') + '?' + qs, { cache: 'no-store', signal: controller.signal })
      .then(async res => { const data = await res.json(); if (!res.ok) throw Error(data.error); if (!controller.signal.aborted) setRows(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load billing records.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, page, revision, search, view, status, customer]);
  const change = (values: Record<string, string>) => {
    setPage(0);
    router.replace('/app/' + kind + '?' + new URLSearchParams({ view, status, customer, search, ...values }));
  };
  const isCustomers = kind === 'customers';
  return <div className={styles.workspace}>
    <PageHeader title={isCustomers ? 'Customers' : 'Invoices & receipts'}
      description={isCustomers ? 'The people buying from your business. Follow their purchases, payment history and recurring permissions in one place.' : customer ? 'Billing history for ' + customer : 'Every checkout and renewal, with its original terms and verified payment record.'}
      action={<SecondaryButton disabled={loading} onClick={() => setRevision(n => n + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</SecondaryButton>} />
    <div className={styles.toolbar}>
      {isCustomers ? <form className={styles.search} onSubmit={e => { e.preventDefault(); change({ search: query.trim() }); }}>
        <Search size={16} aria-hidden /><input aria-label="Search customers" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} placeholder="Find a customer by account…" />
        <button type="submit">Search</button>
      </form> : <>
        <nav aria-label="Invoice ownership" className={styles.tabs}>
          <button aria-pressed={view === 'issued'} onClick={() => change({ view: 'issued' })}>Issued to customers</button>
          <button aria-pressed={view === 'purchases'} onClick={() => change({ view: 'purchases', customer: '' })}>My purchases</button>
        </nav>
        <label className={styles.filter}>Status<select aria-label="Invoice status" value={status} onChange={e => change({ status: e.target.value })}>
          {['ALL', 'OPEN', 'PAID', 'EXPIRED', 'VOID'].map(s => <option key={s} value={s}>{s === 'ALL' ? 'All invoices' : s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select></label>
        {customer && <button className={styles.clear} onClick={() => change({ customer: '' })}>Clear customer filter</button>}
      </>}
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <SoftCard className={styles.tableCard}>
      <div className={styles.tableHeading}><strong>{isCustomers ? 'Customer directory' : view === 'issued' ? 'Issued invoices' : 'Your billing history'}</strong><span>{!loading && !error && rows ? rows.total + (isCustomers ? ' customers' : ' invoices') : '—'}</span></div>
      {loading ? <div role="status" className={styles.empty}>Loading {kind}…</div> : error ? <div className={styles.empty}>Records could not be loaded. Use Refresh to try again.</div> : !rows?.total ? <div className={styles.empty}>
        {isCustomers ? <UsersRound size={30} /> : <FileText size={30} />}
        <h2>{search || customer || status !== 'ALL' ? 'No matching records' : isCustomers ? 'Your first customer starts here' : 'No invoices yet'}</h2>
        <p>{isCustomers ? 'Customers appear when someone opens a checkout for one of your plans. Completed payments and recurring permissions are tracked separately.' : view === 'purchases' ? 'Invoices for purchases made with your signed-in account will appear here.' : 'Opening a checkout creates an invoice. A verified payment adds its receipt; every renewal gets its own record.'}</p>
        <Link href="/app/plans">View your plans <ArrowUpRight size={14} /></Link>
      </div> : <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr>{(isCustomers ? ['Customer', 'Relationship', 'Paid invoices', 'Recurring permissions', 'Last activity', ''] : ['Invoice / plan', view === 'purchases' ? 'Provider' : 'Customer', 'Amount', 'Issued', 'Status', '']).map((h, i) => <th key={i} scope="col">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
        <tbody>{isCustomers ? rows.customers?.map(c => <tr key={c.holder}>
          <td><div className={styles.identity}><span className={styles.avatar}>{c.holder.slice(0, 1).toUpperCase()}</span><div><strong className={styles.account} title={c.holder}>{c.holder}</strong><small>First checkout {billingDate(c.first_seen)}</small></div></div></td>
          <td><StatusPill tone={c.payments ? 'good' : 'neutral'}>{c.payments ? 'Paying customer' : 'Awaiting first payment'}</StatusPill></td>
          <td>{c.payments} <small>of {c.invoices} invoices</small></td>
          <td>{c.active_subscriptions} active</td><td>{billingDate(c.last_seen)}</td>
          <td><Link className={styles.action} href={'/app/invoices?customer=' + encodeURIComponent(c.holder)}>View billing <ArrowUpRight size={14} /></Link></td>
        </tr>) : rows.documents?.map(d => <tr key={d.id}>
          <td><strong>{d.terms.planName}</strong><small className={styles.number}>{documentNumber(d.id)}</small><small>{d.terms.kind === 'renewal' ? 'Subscription renewal' : d.terms.kind === 'subscription' ? 'First subscription period' : 'One-time purchase'}</small></td>
          <td><span className={styles.account} title={view === 'purchases' ? d.provider_id : d.holder}>{view === 'purchases' ? d.provider_id : d.holder}</span></td>
          <td className={styles.amount}>{d.terms.amount}<small>stablecoin · chain {d.terms.chainId}</small></td>
          <td>{billingDate(d.created_at)}</td><td><StatusPill tone={d.status === 'PAID' ? 'good' : d.status === 'OPEN' ? 'warn' : 'neutral'}>{d.status === 'OPEN' ? 'Awaiting payment' : d.status.toLowerCase()}</StatusPill></td>
          <td><Link className={styles.action} href={'/app/invoices/' + d.id}>{d.status === 'PAID' ? 'Invoice & receipt' : 'View invoice'} <ArrowUpRight size={14} /></Link></td>
        </tr>)}</tbody>
      </table></div>}
      {!loading && !error && Boolean(rows?.total) && <div className={styles.pagination}><span>Page {page + 1} · dates in UTC</span><div><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><button disabled={(page + 1) * 20 >= (rows?.total ?? 0) || page >= 500} onClick={() => setPage(p => p + 1)}>Next</button></div></div>}
    </SoftCard>
    <p className={styles.note}>{isCustomers ? 'Customer accounts can be email addresses or application-assigned holder IDs. A checkout alone does not prove payment or grant access.' : 'Paid means a verified on-chain payment was recorded. Issued documents preserve checkout terms; they do not assess taxes. No billing email is stored on-chain.'}</p>
  </div>;
}
