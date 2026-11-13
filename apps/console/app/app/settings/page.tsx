'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { WalletStatusCard } from '../../../components/wallet/WalletStatus';
import { ProviderGas } from '../../../components/app/ProviderGas';
import { PageHeader } from '../../../components/app/ui';
import { entitlementsApi, type MumbaiStatus } from '../../../lib/entitlements-client';

type Check = { id: string; ok: boolean; title: string; need: string; action?: string };

export default function SettingsPage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ email_verified?: boolean; wallet_address?: string } | null>(
    null,
  );
  const [gas, setGas] = useState<{
    status?: string;
    expires_at?: string;
    authorization?: { subscriptions?: boolean };
    balances?: { avalanche?: string | null };
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    const read = async (path: string) => {
      const r = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error('Could not load deployment check data');
      return r.json();
    };
    void Promise.all([read('/api/me'), read('/api/provider-gas')])
      .then(([me, fees]) => {
        if (!stopped) {
          setIdentity(me);
          setGas(fees);
        }
      })
      .catch((e) => {
        if (!stopped) setError(e instanceof Error ? e.message : 'Check data is unavailable');
      });
    return () => {
      stopped = true;
    };
  }, []);

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
          ok: Boolean(identity?.email_verified && identity.wallet_address),
          title: 'Verified email and wallet ownership',
          need: 'Verified email receives billing messages; wallet signatures authorize financial actions.',
          action: '/app/account',
        },
        {
          id: 'avalanche',
          ok: Boolean(status.tracks.avalanche.usdt && !status.tracks.avalanche.demo_settle),
          title: 'Avalanche payment token configured',
          need: 'Customers pay the payout wallet configured on each plan. Your dedicated gas account pays the network fees for provider operations.',
          action: '/app/plans',
        },
        {
          id: 'provider-gas',
          ok: Boolean(
            gas?.status === 'active' &&
            gas.authorization?.subscriptions &&
            gas.expires_at &&
            new Date(gas.expires_at).getTime() > Date.now() + 31 * 86400000 &&
            Number(gas.balances?.avalanche ?? 0) > 0,
          ),
          title: 'Authorized and funded provider gas',
          need:
            gas?.status !== 'active'
              ? 'Sign the provider gas permission below. No development approval is imported.'
              : Number(gas.balances?.avalanche ?? 0) <= 0
                ? 'Permission is active, but its dedicated address needs Fuji AVAX before contract writes can proceed.'
                : 'Gas address is funded. Monthly checkout additionally requires subscription authorization with at least 31 days remaining; sufficient balance is checked before every operation.',
          action: '/app/settings#provider-gas',
        },
        {
          id: 'registry',
          ok: status.tracks.registry.live,
          title: 'Entitlement registry',
          need: status.tracks.registry.live
            ? 'Connected to the authoritative Avalanche entitlement registry.'
            : status.dual_gate.provider_funded_gas
              ? 'Set AVALANCHE_ENTITLEMENT_REGISTRY and ENTITLEMENT_STORE=avalanche, then authorize and fund the provider gas account.'
              : 'Set AVALANCHE_ENTITLEMENT_REGISTRY and ENTITLEMENT_STORE=avalanche.',
          action: '/app/grants',
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <PageHeader title="Network & gas" description="Manage your wallet connection, provider gas authorization and Avalanche readiness." />
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--deny)]">{error}</p>}

      <WalletStatusCard title="Browser wallet" persistToAccount />
      <ProviderGas />

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="font-semibold">Deployment checks</h2>
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
                  <Link
                    href={c.action}
                    className="mt-2 inline-block text-xs font-semibold text-[var(--blue)] underline"
                  >
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
                status.tracks.avalanche.demo_settle ? 'Payment verification: development mode' : 'Payment verification: live',
                'Network fees: provider-funded',
              ],
            },
            {
              t: 'Registry',
              lines: [
                status.tracks.registry.live ? 'Authoritative access records connected' : 'Connection needs attention',
                'Credits and paid access are verified on-chain',
              ],
              extra: (
                <Link
                  href="/app/registry"
                  className="mt-3 inline-block text-xs font-semibold text-[var(--blue)] underline"
                >
                  Open Registry studio →
                </Link>
              ),
            },
          ].map((c) => (
            <div
              key={c.t}
              className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]"
            >
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
                <strong>{f.label}</strong> <span className="fi-mono text-xs text-[var(--muted)]">{f.id}</span>
                <span className="text-[var(--muted)]"> · {f.actions.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
