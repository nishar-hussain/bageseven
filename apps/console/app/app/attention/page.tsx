'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi, type MumbaiStatus } from '../../../lib/entitlements-client';
import { mandateApi } from '../../../lib/mandate-client';

type Item = { title: string; detail: string; href: string; tone: 'warn' | 'info' };

export default function AttentionPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<MumbaiStatus | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, live, mandates] = await Promise.all([
          entitlementsApi.status(),
          entitlementsApi.live(),
          mandateApi.list('all').catch(() => ({ mandates: [] })),
        ]);
        setStatus(s);
        const next: Item[] = [];
        if ((live.grants ?? []).length === 0) {
          next.push({
            title: 'No entitlements',
            detail: 'Create an entitlement for a feature (OCR is only a demo SKU) so agents have something to spend.',
            href: '/app/mint',
            tone: 'warn',
          });
        }
        if ((mandates.mandates ?? []).length === 0) {
          next.push({
            title: 'No funded mandate',
            detail: 'Policy DB has no BagMandate. Local Anvil: pnpm setup / pnpm seed:local. Then open Mandate for vault + agents.',
            href: '/app/mandate',
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
        if (s.tracks.whitechain.demo_settle) {
          next.push({
            title: 'Whitechain demo settle',
            detail: 'Set WHITECHAIN_PRIVATE_KEY + WHITECHAIN_PAY_TO for a live stamp, or paste a real payment_tx.',
            href: '/app/credits',
            tone: 'info',
          });
        }
        if (s.tracks.world.mock_proofs) {
          next.push({
            title: 'World mock proofs on',
            detail: 'Set WORLD_MOCK_PROOFS=false and mint with World IDKit on /app/mint for live uniqueness proofs.',
            href: '/app/mint',
            tone: 'info',
          });
        } else if (!s.tracks.world.idkit) {
          next.push({
            title: 'World IDKit credentials missing',
            detail: 'Set WORLD_APP_ID, WORLD_RP_ID, and WORLD_RP_SIGNING_KEY from the Developer Portal.',
            href: '/app/mint',
            tone: 'warn',
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
          Ops checklist (under Settings).{' '}
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
