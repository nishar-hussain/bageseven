'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { billingApi, type CheckoutSession, type Plan } from '../../../lib/billing-client';
import { useOperator } from '../../../lib/use-operator';

export default function CheckoutsPage() {
  const op = useOperator();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sessions, setSessions] = useState<CheckoutSession[]>([]);
  const [planId, setPlanId] = useState('');
  const [holder, setHolder] = useState('');
  const [msg, setMsg] = useState('');
  const [lastUrl, setLastUrl] = useState('');

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([billingApi.listPlans(), billingApi.listCheckouts()]);
    setPlans(p.plans);
    setSessions(s.sessions);
    if (!planId && p.plans[0]) setPlanId(p.plans[0].id);
  }, [planId]);

  useEffect(() => {
    if (op.holder) setHolder(op.holder);
  }, [op.holder]);

  useEffect(() => {
    void refresh().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      const r = await billingApi.createCheckout({ plan_id: planId, holder });
      const origin = window.location.origin;
      const url = `${origin}/checkout?session=${encodeURIComponent(r.session.id)}`;
      setLastUrl(url);
      setMsg(`Session ${r.session.id} opened`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Checkouts</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Open a checkout session for a holder. Embed or share the public checkout URL — buyer pays your provider wallet on Whitechain. A 0.1% platform fee is billed separately after successful payment.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <form onSubmit={(e) => void open(e)} className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
          Plan
          <select className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.amount} USDT)
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
          Holder
          <input className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={holder} onChange={(e) => setHolder(e.target.value)} required />
        </label>
        <button type="submit" disabled={!planId} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Create checkout session
        </button>
        {lastUrl && (
          <p className="text-sm">
            Public URL:{' '}
            <Link className="font-medium text-[var(--blue)] underline" href={lastUrl}>
              {lastUrl}
            </Link>
          </p>
        )}
      </form>

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Recent sessions</h2>
        {sessions.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">No sessions yet.</p>}
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div className="font-semibold">{s.id}</div>
                <div className="text-xs text-[var(--muted)]">
                  {s.status} · {s.holder} · {s.amount} USDT
                  {s.status === 'PAID' ? ` · provider fee owed: ${s.platform_fee_amount} USDT` : ''}
                  {s.grant_id ? ` · grant ${s.grant_id.slice(0, 8)}…` : ''}
                </div>
              </div>
              <Link href={`/checkout?session=${encodeURIComponent(s.id)}`} className="text-xs font-semibold text-[var(--blue)] underline">
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
