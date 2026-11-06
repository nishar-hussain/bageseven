'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GrantList } from '../../components/app/GrantList';
import { PageHeader, SoftCard, StatusPill } from '../../components/app/ui';
import { entitlementsApi, type Grant, type MumbaiStatus } from '../../lib/entitlements-client';

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const w = 560;
  const h = 160;
  const step = w / Math.max(points.length - 1, 1);
  const d = points
    .map((p, i) => {
      const x = Math.round(i * step * 1000) / 1000;
      const y = Math.round((h - (p / max) * (h - 16) - 8) * 1000) / 1000;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function creditsSeries(grants: Grant[], days: number): number[] {
  const now = Date.now();
  const dayMs = 86_400_000;
  return Array.from({ length: days }, (_, i) => {
    const t = now + i * dayMs;
    return grants.reduce((sum, g) => {
      const end = new Date(g.paid_through).getTime();
      if (Number.isNaN(end) || end <= t) return sum;
      return sum + Number(g.remaining || 0);
    }, 0);
  });
}

export default function OverviewPage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [range, setRange] = useState<'7' | '30' | '180'>('30');
  const [setup, setSetup] = useState<{ email: boolean; wallet: boolean }>({ email: false, wallet: false });
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, live, me] = await Promise.all([
        entitlementsApi.status().catch(() => null),
        entitlementsApi.live(),
        fetch('/api/me', { signal: AbortSignal.timeout(8_000) })
          .then(async (r) =>
            r.ok
              ? ((await r.json()) as { email_verified?: boolean; wallet_address?: string | null })
              : null,
          )
          .catch(() => null),
      ]);
      setStatus(s);
      setGrants(live.grants ?? []);
      setSetup({
        email: !me?.email_verified,
        wallet: !me?.wallet_address,
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const remaining = useMemo(
    () => grants.reduce((acc, g) => acc + Number(g.remaining || 0), 0),
    [grants],
  );

  const days = range === '7' ? 7 : range === '30' ? 30 : 180;
  const spark = useMemo(() => creditsSeries(grants, days), [grants, days]);

  const attentionBits: string[] = [];
  if (grants.length === 0) attentionBits.push('no entitlements yet');
  if (status && !status.tracks.arkiv.live) attentionBits.push('Arkiv on local store');
  if (status?.tracks.whitechain.demo_settle) attentionBits.push('Whitechain settle offline');
  if (setup.email) attentionBits.push('email unverified');
  if (setup.wallet) attentionBits.push('wallet not set');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Overview"
        description="Living entitlements for your features — credits, TTL, and agent spend under mandate."
      />

      {attentionBits.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 shadow-[var(--sh)]">
          <p className="text-sm text-[var(--ink)]">
            <strong className="text-[var(--blue)]">{attentionBits.length} need attention</strong>
            <span className="text-[var(--muted)]"> · {attentionBits.join(', ')}</span>
          </p>
          <Link
            href="/app/attention"
            className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--soft)]"
          >
            Review
          </Link>
        </div>
      ) : null}

      <SoftCard className="p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Credits remaining</h2>
          <div className="flex rounded-full border border-[var(--line)] bg-[var(--soft)] p-0.5 text-xs font-medium">
            {(['7', '30', '180'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1.5 ${range === r ? 'bg-white shadow-sm' : 'text-[var(--muted)]'}`}
              >
                {r === '7' ? '7 days' : r === '30' ? '30 days' : '180 days'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="text-4xl font-semibold tracking-tight tabular-nums">{remaining.toFixed(2)}</div>
          <div className="mb-1 text-sm text-[var(--muted)]">across living entitlements</div>
          {grants.length === 0 ? (
            <StatusPill tone="warn">None yet</StatusPill>
          ) : (
            <StatusPill tone="good">{grants.length} live</StatusPill>
          )}
        </div>
        <div className="mt-4">
          <Sparkline points={spark.length ? spark : [0, 0]} />
        </div>
      </SoftCard>

      <div className="grid gap-4 md:grid-cols-2">
        <SoftCard className="p-5">
          <h2 className="text-[15px] font-semibold">Workspace</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Entitlements</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{grants.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Credits</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{remaining.toFixed(0)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">World</dt>
              <dd className="mt-1 text-lg font-medium capitalize">{status?.tracks.world.mode ?? '…'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Arkiv</dt>
              <dd className="mt-1 text-lg font-medium">{status?.tracks.arkiv.live ? 'Live' : 'Local'}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/app/mint" className="rounded-full bg-[var(--ink)] px-3.5 py-2 text-sm font-semibold text-white">
              Create entitlement
            </Link>
            <Link href="/app/features" className="rounded-full border border-[var(--line)] px-3.5 py-2 text-sm font-medium">
              Features
            </Link>
            <Link href="/app/credits" className="rounded-full border border-[var(--line)] px-3.5 py-2 text-sm font-medium">
              Buy credits
            </Link>
          </div>
        </SoftCard>

        <SoftCard className="p-5">
          <h2 className="text-[15px] font-semibold">Mandate</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Spend ceiling for agents. Dual-gate needs this and a living entitlement.
          </p>
          <Link href="/app/mandate" className="mt-4 inline-flex rounded-full border border-[var(--line)] px-3.5 py-2 text-sm font-medium">
            Open mandate →
          </Link>
        </SoftCard>
      </div>

      <GrantList />

      {msg ? <p className="fi-mono text-xs text-[var(--deny)]">{msg}</p> : null}
    </div>
  );
}
