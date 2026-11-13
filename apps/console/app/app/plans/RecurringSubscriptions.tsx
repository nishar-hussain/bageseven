'use client';
import { useEffect, useState } from 'react';
import type { Subscription } from '@bagseven/sdk/node';

export function RecurringSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/billing/subscriptions', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw Error(data.error?.message || 'Could not load recurring payments');
        if (!stopped) { setSubscriptions(data.subscriptions); setError(''); }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return <section id="subscriptions" className="rounded-2xl border border-[var(--line)] bg-white p-5">
    <h2 className="text-base font-semibold">Recurring subscriptions</h2>
    <p className="mt-1 text-sm text-[var(--muted)]">Customer-authorized wallet payments every 30 days. Access renews after confirmed payment.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!error && !subscriptions.length && <p className="mt-4 text-sm text-[var(--muted)]">No recurring subscriptions yet. Create a monthly plan, renew your provider gas authorization in Network & gas, then open its checkout.</p>}
    {subscriptions.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr>{['Customer', 'Feature', 'Price / 30 days', 'Status', 'Paid through', 'Next attempt', 'Collection details'].map(title => <th className="p-2" key={title}>{title}</th>)}</tr></thead>
      <tbody>{subscriptions.map(sub => <tr key={sub.id} className="border-t border-[var(--line)]">
        <td className="max-w-48 truncate p-2" title={sub.holder}>{sub.holder}</td><td className="p-2">{sub.feature}</td><td className="p-2">{sub.amount} stablecoin</td>
        <td className="p-2">{sub.status.replaceAll('_', ' ')}</td><td className="p-2">{new Date(sub.paid_through).toLocaleString()}</td>
        <td className="p-2">{['ENDED', 'CANCELLED'].includes(sub.status) ? '—' : new Date(sub.next_attempt_at).toLocaleString()}</td>
        <td className="max-w-72 p-2">{sub.last_error || 'Payment confirmed'}{sub.failures > 0 && ` · ${sub.failures}/4 customer failures`}
          {sub.attempts.length > 0 && <details><summary>Attempt history</summary>{sub.attempts.map((attempt, i) => <p key={i}>{new Date(attempt.at * 1000).toLocaleString()}: {attempt.reason}</p>)}</details>}
        </td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
