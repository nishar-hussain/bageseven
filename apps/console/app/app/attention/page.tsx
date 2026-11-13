'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, SoftCard, StatusPill } from '../../../components/app/ui';
import { entitlementsApi } from '../../../lib/entitlements-client';
import { mandateApi } from '../../../lib/mandate-client';

type Item = { title: string; detail: string; href: string; tone: 'warn' | 'info' };

export default function AttentionPage() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [s, live, mandates, me] = await Promise.all([
          entitlementsApi.status(),
          entitlementsApi.live(),
          mandateApi.list('owner').catch(() => ({ mandates: [] })),
          fetch('/api/me')
            .then(async (r) =>
              r.ok
                ? ((await r.json()) as { email_verified?: boolean; wallet_address?: string | null })
                : null,
            )
            .catch(() => null),
        ]);
        const next: Item[] = [];
        if (!me?.email_verified) {
          next.push({
            title: 'Verify email',
            detail: 'Optional — used for receipts and recovery. You can skip and add it later from Account.',
            href: '/app/account#email',
            tone: 'info',
          });
        }
        if (!me?.wallet_address) {
          next.push({
            title: 'Add payout wallet',
            detail: 'Optional — connect a Avalanche wallet for plan payouts.',
            href: '/app/account#wallet',
            tone: 'info',
          });
        }
        if ((live.grants ?? []).length === 0) {
          next.push({
            title: 'No live entitlements yet',
            detail: 'Create an entitlement so agents have living Registry access to spend against.',
            href: '/app/mint',
            tone: 'warn',
          });
        }
        if ((mandates.mandates ?? []).length === 0) {
          next.push({
            title: 'No funded mandate',
            detail: 'Fund a mandate for agent spend ceilings, then connect MCP.',
            href: '/app/mandate',
            tone: 'warn',
          });
        }
        if (!s.tracks.registry.live) {
          next.push({
            title: 'Registry on local store',
            detail: 'Set AVALANCHE_ENTITLEMENT_REGISTRY and ENTITLEMENT_SUBJECT_SECRET, then restart the daemon.',
            href: '/app/settings',
            tone: 'info',
          });
        }
        if (s.tracks.avalanche.demo_settle) {
          next.push({
            title: 'Avalanche settle not wired',
            detail: 'Set AVALANCHE_PRIVATE_KEY and AVALANCHE_PAY_TO for live settlement.',
            href: '/app/settings',
            tone: 'info',
          });
        }
        setItems(next);
      } catch {
        setItems([
          {
            title: 'Daemon unreachable',
            detail: 'Start the local stack and refresh.',
            href: '/app/settings',
            tone: 'warn',
          },
        ]);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Needs attention" description={items.length === 0 ? 'All clear.' : `${items.length} open`} />

      <div className="space-y-3">
        {items.map((it) => (
          <SoftCard key={it.title} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{it.title}</h2>
                  <StatusPill tone={it.tone === 'warn' ? 'warn' : 'neutral'}>
                    {it.tone === 'warn' ? 'Action' : 'Setup'}
                  </StatusPill>
                </div>
                <p className="mt-1 text-[13px] text-[var(--muted)]">{it.detail}</p>
              </div>
              <Link
                href={it.href}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--soft)]"
              >
                Open
              </Link>
            </div>
          </SoftCard>
        ))}
        {items.length === 0 ? (
          <SoftCard className="p-10 text-center">
            <p className="text-[var(--muted)]">Nothing queued.</p>
            <Link href="/app" className="mt-4 inline-block text-sm font-semibold text-[var(--blue)]">
              Back to overview →
            </Link>
          </SoftCard>
        ) : null}
      </div>
    </div>
  );
}
