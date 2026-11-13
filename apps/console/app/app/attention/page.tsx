'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, SoftCard, StatusPill } from '../../../components/app/ui';
import { entitlementsApi } from '../../../lib/entitlements-client';
import { mandateApi } from '../../../lib/mandate-client';

type Item = { title: string; detail: string; href: string; tone: 'warn' | 'info' };

export default function AttentionPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

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
            detail: 'Verify your account email for sign-in, billing records and account recovery.',
            href: '/app/account#email',
            tone: 'info',
          });
        }
        if (!me?.wallet_address) {
          next.push({
            title: 'Verify wallet ownership',
            detail: 'Connect your Avalanche wallet and sign the ownership message to complete your account.',
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
            title: 'Agent payments are not enabled',
            detail: 'Optional: create a spending mandate when an agent needs to make new payments. Prepaid access and MCP connection do not require one.',
            href: '/app/mandate',
            tone: 'info',
          });
        }
        if (!s.tracks.registry.live) {
          next.push({
            title: 'Review the registry connection',
            detail: 'Your entitlement registry is unavailable. Check the connection in Network & gas.',
            href: '/app/settings',
            tone: 'info',
          });
        }
        if (s.tracks.avalanche.demo_settle) {
          next.push({
            title: 'Review payment configuration',
            detail: 'Live payment verification is not enabled. Review the payment token and provider authorization in Network & gas.',
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
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Needs attention" description={loading ? 'Checking your account and workspace…' : items.length === 0 ? 'Your workspace checks are clear.' : `${items.length} items to review`} />

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
        {loading ? <p role="status" className="text-sm text-[var(--muted)]">Checking workspace…</p> : items.length === 0 ? (
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
