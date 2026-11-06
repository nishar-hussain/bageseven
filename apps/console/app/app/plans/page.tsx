'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { billingApi, type Plan } from '../../../lib/billing-client';
import { FEATURE_OPTIONS, useOperator } from '../../../lib/use-operator';
import { connectWhitechainWallet } from '@bagseven/sdk/wallet';

export default function PlansPage() {
  const op = useOperator();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('OCR Starter');
  const [feature, setFeature] = useState('ocr');
  const [amount, setAmount] = useState('5.00');
  const [credits, setCredits] = useState('10');
  const [ttl, setTtl] = useState(3600);
  const [interval, setInterval] = useState<'once' | 'month'>('once');
  const [wallet, setWallet] = useState('0x1111111111111111111111111111111111111111');

  const refresh = useCallback(async () => {
    const r = await billingApi.listPlans();
    setPlans(r.plans);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await billingApi.createPlan({
        name,
        feature,
        amount,
        credits,
        ttl_seconds: ttl,
        interval,
        merchant_wallet: wallet,
      });
      setMsg('Plan created');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Thin plans only — price + feature + credits. Checkout sessions mint living Arkiv grants. No payment-link catalog.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <form onSubmit={(e) => void create(e)} className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Create plan</h2>
        <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
          Name
          <input className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
          Feature
          <select className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={feature} onChange={(e) => setFeature(e.target.value)}>
            {FEATURE_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
            Amount USDT
            <input className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
            Credits
            <input className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={credits} onChange={(e) => setCredits(e.target.value)} required />
          </label>
          <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
            Interval
            <select className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={interval} onChange={(e) => setInterval(e.target.value as 'once' | 'month')}>
              <option value="once">Once</option>
              <option value="month">Month</option>
            </select>
          </label>
        </div>
        <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
          TTL seconds
          <input type="number" className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
        </label>
        <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
          Payout wallet (Whitechain)
          <div className="mt-1 flex gap-2">
            <input className="w-full rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-xs" value={wallet} onChange={(e) => setWallet(e.target.value)} required />
            <button
              type="button"
              className="shrink-0 rounded-full border border-[var(--line)] px-3 text-xs font-semibold"
              onClick={() =>
                void connectWhitechainWallet()
                  .then(({ address }) => setWallet(address))
                  .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
              }
            >
              Connect
            </button>
          </div>
        </label>
        <button type="submit" disabled={busy || !op.holder} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Create plan'}
        </button>
      </form>

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Your plans</h2>
        {plans.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">No plans yet.</p>}
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {plans.map((p) => (
            <li key={p.id} className="py-3 text-sm">
              <div className="font-semibold">{p.name}</div>
              <div className="fi-mono text-xs text-[var(--muted)]">
                {p.id} · {p.feature} · {p.amount} USDT · {p.credits} credits · {p.interval}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
