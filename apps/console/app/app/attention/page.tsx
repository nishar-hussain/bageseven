'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi, type MumbaiStatus } from '../../../lib/entitlements-client';

type Item = { title: string; detail: string; href: string; tone: 'warn' | 'info' };

export default function AttentionPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<MumbaiStatus | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, live] = await Promise.all([entitlementsApi.status(), entitlementsApi.live({ feature: 'ocr' })]);
        setStatus(s);
        const next: Item[] = [];
        if ((live.grants ?? []).length === 0) {
          next.push({
            title: 'No living grant',
            detail: 'Mint with World so agents have an Arkiv access clock.',
            href: '/app/mint',
            tone: 'warn',
          });
        }
        if (!s.tracks.arkiv.live) {
          next.push({
            title: 'Arkiv is memory',
            detail: 'Set ARKIV_ACCESS_KEY + ARKIV_PRIVATE_KEY and restart daemon for live entities.',
            href: '/app/settings',
            tone: 'info',
          });
        }
        if (s.tracks.hedera.demo_settle) {
          next.push({
            title: 'Hedera demo settle',
            detail: 'Set HEDERA_X402_FACILITATOR_URL for live settle, or paste a real payment_tx.',
            href: '/app/credits',
            tone: 'info',
          });
        }
        if (s.tracks.world.mode !== 'live') {
          next.push({
            title: 'World mock proofs',
            detail: 'Set WORLD_CLIENT_ID and paste id_token on Mint for live Agent Pass.',
            href: '/app/mint',
            tone: 'info',
          });
        }
        setItems(next);
      } catch {
        setItems([
          {
            title: 'Daemon unreachable',
            detail: 'Start pnpm start:local and refresh.',
            href: '/app/settings',
            tone: 'warn',
          },
        ]);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Needs attention</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {items.length === 0 ? 'All clear for this workspace.' : `${items.length} open item${items.length === 1 ? '' : 's'}.`}
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.title}
            className={`rounded-2xl border bg-white p-4 shadow-[var(--sh)] ${
              it.tone === 'warn' ? 'border-orange-200' : 'border-[var(--line)]'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{it.title}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{it.detail}</p>
              </div>
              <Link href={it.href} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--soft)]">
                Fix
              </Link>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-2xl border border-[var(--line)] bg-white p-8 text-center shadow-[var(--sh)]">
            <p className="text-[var(--muted)]">Nothing queued. Tracks look healthy for demo.</p>
            <Link href="/app" className="mt-4 inline-block text-sm font-semibold text-[var(--blue)] underline">
              Back to overview →
            </Link>
          </div>
        )}
      </div>

      {status && (
        <p className="fi-mono text-xs text-[var(--muted)]">
          dual-gate feature={status.dual_gate.feature} require={String(status.dual_gate.require_grant)}
        </p>
      )}
    </div>
  );
}
