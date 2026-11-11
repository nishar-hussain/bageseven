'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { WalletStatusCard } from '../../../components/wallet/WalletStatus';
import { ProviderGas } from '../../../components/app/ProviderGas';
import { entitlementsApi, type MumbaiStatus } from '../../../lib/entitlements-client';

type Check = { id: string; ok: boolean; title: string; need: string; action?: string };

export default function SettingsPage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    entitlementsApi
      .status()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const checks: Check[] = status
    ? [
        {
          id: 'account',
          ok: true,
          title: 'Email and Avalanche wallet',
          need: 'Verified email receives billing messages; wallet signatures authorize financial actions.',
          action: '/app/account',
        },
        {
          id: 'avalanche',
          ok: Boolean(status.tracks.avalanche.usdt && (status.dual_gate.provider_funded_gas || status.tracks.avalanche.pay_to)),
          title: 'Avalanche stablecoin (money clock)',
          need: status.dual_gate.provider_funded_gas
            ? 'Provider checkout pays each plan’s merchant wallet. Fund and authorize your dedicated gas account below; platform keys are not fee payers.'
            : !status.tracks.avalanche.pay_to
            ? 'Set AVALANCHE_PAY_TO (payout wallet) or AVALANCHE_PRIVATE_KEY — Mint / Buy credits need a recipient. Restart daemon after changing .env.'
            : status.tracks.avalanche.demo_settle
              ? `Recipient ${status.tracks.avalanche.pay_to.slice(0, 10)}… · demo settle on. Set AVALANCHE_DEMO_SETTLE=false for live verify.`
              : `Live · recipient ${status.tracks.avalanche.pay_to.slice(0, 10)}… · stablecoin configured.`,
          action: '/app/plans',
        },
        {
          id: 'registry',
          ok: status.tracks.registry.live,
          title: 'Registry living grants',
          need: status.tracks.registry.live
            ? 'Live store — grants are queryable entities.'
            : status.dual_gate.provider_funded_gas ? 'Set AVALANCHE_ENTITLEMENT_REGISTRY and ENTITLEMENT_STORE=avalanche, then authorize and fund the provider gas account.' : 'Set AVALANCHE_ENTITLEMENT_REGISTRY and ENTITLEMENT_STORE=avalanche.',
          action: '/app/grants',
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight md:text-[2rem]">Tracks</h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--muted)]">
          Infrastructure readiness from server env. Secrets never leave the server.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--deny)]">{error}</p>}

      <WalletStatusCard title="Browser wallet" persistToAccount />
      <ProviderGas />

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="font-semibold">Go-live checklist</h2>
        <ul className="mt-4 space-y-3">
          {checks.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-xl border border-[var(--line)] p-3 text-sm">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                  c.ok ? 'bg-[var(--good)]' : 'bg-[var(--deny)]'
                }`}
              >
                {c.ok ? '✓' : '!'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.title}</div>
                <p className="mt-1 text-[var(--muted)]">{c.need}</p>
                {c.action ? (
                  <Link href={c.action} className="mt-2 inline-block text-xs font-semibold text-[var(--blue)] underline">
                    Open →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {status && (
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              t: 'Account',
              lines: ['Email sign-in', 'Signed Avalanche wallet ownership'],
            },
            {
              t: 'Avalanche',
              lines: [
                `Network: ${status.tracks.avalanche.network} (${status.tracks.avalanche.chain_id})`,
                `Operator: ${status.tracks.avalanche.operator}`,
                `Demo settle: ${status.tracks.avalanche.demo_settle}`,
              ],
            },
            {
              t: 'Registry',
              lines: [`Store: ${status.tracks.registry.store}`, `Live entities: ${status.tracks.registry.live}`],
              extra: (
                <Link href="/app/registry" className="mt-3 inline-block text-xs font-semibold text-[var(--blue)] underline">
                  Open Registry studio →
                </Link>
              ),
            },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
              <div className="mb-3 h-1 w-10 rounded-full bg-[var(--blue)]" />
              <h2 className="font-semibold">{c.t}</h2>
              {c.lines.map((l) => (
                <p key={l} className="mt-1 text-sm text-[var(--muted)]">
                  {l}
                </p>
              ))}
              {'extra' in c && c.extra ? c.extra : null}
            </div>
          ))}
        </div>
      )}

      {status?.dual_gate.features && status.dual_gate.features.length > 0 && (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="font-semibold">Feature catalog</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {status.dual_gate.features.map((f) => (
              <li key={f.id}>
                <strong>{f.label}</strong>{' '}
                <span className="fi-mono text-xs text-[var(--muted)]">{f.id}</span>
                <span className="text-[var(--muted)]"> · {f.actions.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
