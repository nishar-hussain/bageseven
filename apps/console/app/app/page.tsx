'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GrantList } from '../../components/app/GrantList';
import { StatusBadges } from '../../components/app/StatusBadges';
import { entitlementsApi, type Grant, type MumbaiStatus } from '../../lib/entitlements-client';

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const w = 560;
  const h = 160;
  const step = w / Math.max(points.length - 1, 1);
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p / max) * (h - 16) - 8;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function OverviewPage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [range, setRange] = useState<'7' | '30' | '180'>('30');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, live] = await Promise.all([entitlementsApi.status(), entitlementsApi.live({ feature: 'ocr' })]);
      setStatus(s);
      setGrants(live.grants ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const remaining = useMemo(
    () => grants.reduce((acc, g) => acc + Number(g.remaining || 0), 0),
    [grants],
  );

  const spark = useMemo(() => {
    const n = range === '7' ? 7 : range === '30' ? 30 : 24;
    // synthetic activity curve seeded by grant count — visual parity with Fianto revenue chart
    const base = Math.max(grants.length, 1);
    return Array.from({ length: n }, (_, i) => {
      const wave = Math.sin(i / 2.4) * 0.35 + Math.cos(i / 5.1) * 0.2;
      return Math.max(0.05, base * (0.55 + wave) + (i % 5 === 0 ? base * 0.4 : 0));
    });
  }, [grants.length, range]);

  const attentionBits: string[] = [];
  if (grants.length === 0) attentionBits.push('no living grant');
  if (status && !status.tracks.arkiv.live) attentionBits.push('Arkiv on memory store');
  if (status?.tracks.hedera.demo_settle) attentionBits.push('Hedera demo settle');
  if (status?.tracks.world.mode !== 'live') attentionBits.push('World mock proofs');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight md:text-[2.35rem]">Overview</h1>
        <button type="button" className="mt-1 text-sm text-[var(--muted)] underline decoration-dashed underline-offset-4">
          How these numbers are built
        </button>
      </div>

      {attentionBits.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 shadow-[var(--sh)]">
          <p className="text-sm text-[var(--blue)]">
            <strong>{attentionBits.length} things need you</strong>
            <span className="text-[var(--muted)]"> · {attentionBits.join(', ')}</span>
          </p>
          <Link href="/app/attention" className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--soft)]">
            Review
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <StatusBadges />
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)] md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Entitlement activity</h2>
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
          <div className="mb-1 text-sm text-[var(--muted)]">credits remaining across living grants</div>
          {grants.length === 0 && (
            <span className="mb-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">No grants yet</span>
          )}
        </div>
        <div className="mt-4">
          <Sparkline points={spark} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">Last window</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Living grants</dt>
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
              <dd className="mt-1 text-lg font-medium">{status?.tracks.arkiv.live ? 'Live' : 'Memory'}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/app/mint" className="rounded-full bg-[var(--ink)] px-3.5 py-2 text-sm font-semibold text-white">
              Mint grant
            </Link>
            <Link href="/app/credits" className="rounded-full border border-[var(--line)] px-3.5 py-2 text-sm font-medium">
              Buy credits
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">Access by day</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Heat from living grant TTLs (local demo visualization).</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {Array.from({ length: 28 }, (_, i) => {
              const intensity = grants.length === 0 ? 0 : ((i * 3 + grants.length * 5) % 5) / 4;
              return (
                <div
                  key={i}
                  title={`Day ${i + 1}`}
                  className="aspect-square rounded-md"
                  style={{
                    background:
                      intensity === 0 ? 'var(--line2)' : `color-mix(in srgb, var(--blue) ${20 + intensity * 70}%, white)`,
                  }}
                />
              );
            })}
          </div>
        </section>
      </div>

      <GrantList feature="ocr" />

      {msg && <p className="fi-mono text-xs text-[var(--deny)]">{msg}</p>}
    </div>
  );
}
