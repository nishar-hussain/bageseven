'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, SecondaryButton, SoftCard } from '../../../components/app/ui';

type Checkout = {
  id: string;
  plan: string;
  holder: string;
  amount: string;
  created_at: string;
  status: string;
  paymentTx: string | null;
  chainId: number;
};
function CheckoutList() {
  const params = useSearchParams();
  const router = useRouter();
  const filter = ['ALL', 'PAID', 'PENDING', 'EXPIRED', 'FAILED', 'CANCELLED'].includes(
    params.get('status') ?? '',
  )
    ? params.get('status')!
    : 'ALL';
  const days = [0, 7, 30, 90].includes(Number(params.get('days') ?? 0)) ? Number(params.get('days') ?? 0) : 0;
  const changeFilter = (status: string, period: number) => {
    setPage(0);
    router.replace(`/app/checkouts?status=${status}&days=${period}`);
  };
  const [sessions, setSessions] = useState<Checkout[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const sequence = useRef({ value: 0 }).current;
  const refresh = useCallback(async () => {
    const id = ++sequence.value;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/provider-checkouts?status=${filter}&page=${page}&days=${days}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not load checkouts');
      if (id === sequence.value) {
        setSessions(result.sessions);
        setTotal(result.total);
      }
    } catch (e) {
      if (id === sequence.value) setError(e instanceof Error ? e.message : 'Could not load checkouts');
    } finally {
      if (id === sequence.value) setLoading(false);
    }
  }, [filter, page, days, sequence]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.value++;
    };
  }, [refresh, sequence]);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Checkouts"
        description="Customer checkout sessions for your plans. Subscription renewal collections are listed under Plans. Amounts are checkout quotes, not a combined revenue total."
        action={
          <SecondaryButton onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </SecondaryButton>
        }
      />
      <label className="flex items-center gap-3 text-xs text-[var(--muted)]">
        Status
        <select
          className="rounded border border-[var(--line)] bg-white px-3 py-2"
          value={filter}
          onChange={(e) => {
            changeFilter(e.target.value, days);
          }}
        >
          {['ALL', 'PAID', 'PENDING', 'EXPIRED', 'FAILED', 'CANCELLED'].map((value) => (
            <option key={value} value={value}>
              {value === 'ALL'
                ? 'All checkouts'
                : value === 'PENDING'
                  ? 'Awaiting payment'
                  : value.charAt(0) + value.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-3 text-xs text-[var(--muted)]">
        Period
        <select
          aria-label="Checkout period"
          className="rounded border border-[var(--line)] bg-white px-3 py-2"
          value={days}
          onChange={(e) => changeFilter(filter, Number(e.target.value))}
        >
          <option value={0}>All time</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <span>Checkout creation dates, UTC</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-[var(--deny)]">
          {error}
        </p>
      )}
      <SoftCard className="overflow-hidden">
        {loading ? (
          <p role="status" className="p-10 text-center text-sm text-[var(--muted)]">
            Loading checkouts…
          </p>
        ) : error ? (
          <p className="p-10 text-center text-sm text-[var(--muted)]">
            Could not load this page. Retry using Refresh.
          </p>
        ) : sessions.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--soft)] text-[var(--muted)]">
                  <tr>
                    {['Checkout / plan', 'Customer', 'Created', 'Quoted amount', 'Status', 'Payment'].map(
                      (h) => (
                        <th className="p-4 font-medium" key={h}>
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-t border-[var(--line)]">
                      <td className="p-4">
                        <strong className="block font-medium">{s.plan}</strong>
                        <span className="mt-1 block font-mono text-[10px] text-[var(--muted)]">{s.id}</span>
                      </td>
                      <td className="max-w-48 truncate p-4" title={s.holder}>
                        <Link href={'/app/invoices?customer=' + encodeURIComponent(s.holder)} className="text-[var(--blue)] underline">{s.holder}</Link>
                      </td>
                      <td className="whitespace-nowrap p-4">{new Date(s.created_at).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap p-4">{s.amount} stablecoin</td>
                      <td className="whitespace-nowrap p-4">
                        {s.status === 'PENDING' ? 'Awaiting payment' : s.status.toLowerCase()}
                      </td>
                      <td className="p-4">
                        {s.paymentTx ? (
                          <code className="text-[10px]" title={s.paymentTx}>
                            {s.paymentTx.slice(0, 10)}…
                          </code>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--line)] p-4 text-xs">
              <span>{total} sessions</span>
              <div className="flex gap-4">
                <button
                  disabled={!page}
                  onClick={() => setPage((p) => p - 1)}
                  className="disabled:opacity-30"
                >
                  Previous
                </button>
                <span>Page {page + 1}</span>
                <button
                  disabled={(page + 1) * 20 >= total || page >= 500}
                  onClick={() => setPage((p) => p + 1)}
                  className="disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-12 text-center text-sm">
            <h2>No matching checkouts</h2>
            <p className="mt-3 text-xs text-[var(--muted)]">
              A session appears when a customer starts checkout in your embed.
            </p>
            {page > 0 && (
              <button className="mt-4 text-xs text-[var(--blue)]" onClick={() => setPage(0)}>
                Return to first page
              </button>
            )}
            <Link href="/app/builder" className="mt-5 block text-xs text-[var(--blue)]">
              Open Builder →
            </Link>
          </div>
        )}
      </SoftCard>
    </div>
  );
}

export default function CheckoutsPage() {
  return (
    <Suspense fallback={<p className="p-10 text-sm">Loading checkouts…</p>}>
      <CheckoutList />
    </Suspense>
  );
}
