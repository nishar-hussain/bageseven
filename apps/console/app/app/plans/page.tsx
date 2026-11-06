'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { connectWhitechainWallet } from '../../../lib/bagseven-sdk-wallet';
import {
  EmptyState,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Segmented,
  SoftCard,
  StatusPill,
} from '../../../components/app/ui';
import { billingApi, type Plan } from '../../../lib/billing-client';
import { shortId, useOperator } from '../../../lib/use-operator';
import { featureLabel, useFeatures } from '../../../lib/use-features';

type Filter = 'active' | 'ended' | 'all';

export default function PlansPage() {
  const op = useOperator();
  const { features } = useFeatures();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('OCR Starter');
  const [feature, setFeature] = useState('ocr');
  const [amount, setAmount] = useState('5.00');
  const [credits, setCredits] = useState('10');
  const [ttl, setTtl] = useState(3600);
  const [billingInterval, setBillingInterval] = useState<'once' | 'month'>('once');
  const [wallet, setWallet] = useState('');

  const refresh = useCallback(async () => {
    const r = await billingApi.listPlans();
    setPlans(r.plans);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  useEffect(() => {
    if (op.walletAddress && !wallet) setWallet(op.walletAddress);
  }, [op.walletAddress, wallet]);

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (filter === 'active' && !p.active) return false;
      if (filter === 'ended' && p.active) return false;
      if (!q.trim()) return true;
      const hay = `${p.name} ${p.id} ${p.feature}`.toLowerCase();
      return hay.includes(q.trim().toLowerCase());
    });
  }, [plans, filter, q]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const isBool = features.find((f) => f.id === feature)?.value_type === 'boolean';
      await billingApi.createPlan({
        name,
        feature,
        amount,
        credits: isBool ? '1' : credits,
        ttl_seconds: ttl,
        interval: billingInterval,
        merchant_wallet: wallet,
      });
      setMsg('Plan created');
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Plans"
        description={
          <>
            Priced packages that mint entitlements on pay. Embed them via{' '}
            <Link href="/app/builder" className="font-medium text-[var(--blue)] underline decoration-dotted underline-offset-2">
              Builder
            </Link>{' '}
            (<code className="fi-mono text-xs">cmp_pricing</code>).
          </>
        }
        action={<PrimaryButton onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Close' : 'New plan'}</PrimaryButton>}
      />

      {showCreate ? (
        <SoftCard className="p-5">
          <h2 className="text-[15px] font-semibold">New plan</h2>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Paying this plan entitles the selected feature for the access period (Arkiv grant).
          </p>
          <form onSubmit={(e) => void create(e)} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Name
              <input
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Feature entitled
              <select
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={feature}
                onChange={(e) => {
                  const id = e.target.value;
                  setFeature(id);
                  const ft = features.find((f) => f.id === id);
                  if (ft?.value_type === 'boolean') setCredits('1');
                }}
              >
                {features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.value_type})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Amount (USDT)
              <input
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            {features.find((f) => f.id === feature)?.value_type === 'boolean' ? (
              <div className="fi-field">
                <span className="block text-xs font-semibold uppercase text-[var(--muted)]">Entitlement</span>
                <p className="mt-1 rounded-xl border border-[var(--line)] bg-[var(--soft)] px-3 py-2.5 text-sm">
                  Boolean access on for the whole period
                </p>
              </div>
            ) : (
              <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
                Credits included
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  value={credits}
                  onChange={(e) => setCredits(e.target.value)}
                  required
                />
              </label>
            )}
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Billing
              <select
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={billingInterval}
                onChange={(e) => setBillingInterval(e.target.value as 'once' | 'month')}
              >
                <option value="once">One time</option>
                <option value="month">Every month</option>
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Access period (seconds)
              <input
                type="number"
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
              />
            </label>
            <label className="block text-xs font-semibold uppercase text-[var(--muted)] md:col-span-2">
              Payout wallet
              <div className="mt-1 flex gap-2">
                <input
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-xs"
                  placeholder="0x…"
                  pattern="0x[0-9a-fA-F]{40}"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  required
                />
                <SecondaryButton
                  onClick={() =>
                    void connectWhitechainWallet()
                      .then(({ address }) => setWallet(address))
                      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
                  }
                >
                  Connect
                </SecondaryButton>
              </div>
            </label>
            <div className="md:col-span-2">
              <PrimaryButton type="submit" disabled={busy || !op.holder}>
                {busy ? 'Saving…' : 'Create plan'}
              </PrimaryButton>
            </div>
          </form>
        </SoftCard>
      ) : null}

      {msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}

      <SoftCard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-[var(--muted)]">{filtered.length} total</span>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'ended', label: 'Ended' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search plans"
            className="w-full max-w-xs rounded-full border border-[var(--line)] px-3 py-1.5 text-sm sm:w-56"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={plans.length === 0 ? 'No plans yet' : 'No matching plans'}
            body={
              plans.length === 0
                ? 'Create a plan to price a feature with credits and TTL.'
                : 'Try another filter or search.'
            }
            action={plans.length === 0 ? <PrimaryButton onClick={() => setShowCreate(true)}>New plan</PrimaryButton> : null}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Price</th>
                  <th className="px-4 py-3 font-semibold">Credits</th>
                  <th className="px-4 py-3 font-semibold">Billing</th>
                  <th className="px-4 py-3 font-semibold">Feature</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--soft)]/60">
                    <td className="px-4 py-3.5 font-medium">{p.name}</td>
                    <td className="px-4 py-3.5">
                      <StatusPill tone={p.active ? 'good' : 'neutral'}>{p.active ? 'Active' : 'Ended'}</StatusPill>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-[var(--muted)]" title={p.id}>
                      {shortId(p.id)}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">{p.amount} USDT</td>
                    <td className="px-4 py-3.5 tabular-nums">{p.credits}</td>
                    <td className="px-4 py-3.5 text-[var(--muted)]">{p.interval === 'month' ? 'Every month' : 'One time'}</td>
                    <td className="px-4 py-3.5">{featureLabel(p.feature, features)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-[var(--line)] px-4 py-3 text-[12px] text-[var(--muted)]">
          Showing {filtered.length === 0 ? 0 : 1}–{filtered.length} of {filtered.length} plans
        </div>
      </SoftCard>
    </div>
  );
}
