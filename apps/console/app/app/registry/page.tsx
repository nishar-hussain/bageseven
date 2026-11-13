'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard, StatusPill } from '../../../components/app/ui';
import { entitlementsApi, type Grant, type MumbaiStatus } from '../../../lib/entitlements-client';
import { shortId } from '../../../lib/use-operator';
import { featureLabel, useFeatures } from '../../../lib/use-features';
import { FujiRegistryDeployment } from '../../../components/app/FujiRegistryDeployment';

const REGISTRY_DOCS = 'https://build.avax.network/docs/primary-network';

/**
 * Debug studio for living Registry entitlements — entity keys, store health, explorer links.
 */
export default function RegistryStudioPage() {
  const { features } = useFeatures();
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [store, setStore] = useState<{ mode?: string; live?: boolean; rpcUrl?: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setMsg('');
    try {
      const [st, live] = await Promise.all([entitlementsApi.status(), entitlementsApi.live()]);
      setStatus(st);
      setGrants(live.grants ?? []);
      setStore((live as { store?: { mode?: string; live?: boolean; rpcUrl?: string } }).store ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = async (value: string, id: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1400);
  };

  const registryLive = Boolean(status?.tracks.registry.live);
  const rpc = store?.rpcUrl || 'https://api.avax-test.network/ext/bc/C/rpc';
  const isAnvil = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(rpc);
  const explorer = status?.tracks.avalanche.explorer || 'https://testnet.snowtrace.io';

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Registry studio"
        description="Inspect your Avalanche entitlement registry records, credits, and paid-through times."
        action={
          <>
            {!isAnvil && <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-[13px] font-medium"
            >
              Avalanche explorer
            </a>}
            <PrimaryButton disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Refreshing…' : 'Refresh'}
            </PrimaryButton>
          </>
        }
      />

      {registryLive ? <details className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <summary className="cursor-pointer text-sm font-semibold">Deploy or verify a separate registry</summary>
        <p className="my-4 text-sm text-[var(--muted)]">The platform already has a connected registry. Selling plans and managing access do not require another deployment. Use this advanced flow only to create or verify a separate registry.</p>
        <FujiRegistryDeployment />
      </details> : <FujiRegistryDeployment />}
      <div className="grid gap-4 md:grid-cols-3">
        <SoftCard className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Store</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill tone={registryLive ? 'good' : 'warn'}>{registryLive ? isAnvil ? 'Anvil contract registry' : 'Live Registry' : 'Local memory'}</StatusPill>
          </div>
          <p className="mt-2 fi-mono text-[11px] text-[var(--muted)]">{status?.tracks.registry.store ?? '…'}</p>
        </SoftCard>
        <SoftCard className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">RPC</div>
          <p className="mt-2 break-all fi-mono text-[11px] text-[var(--muted)]">{rpc}</p>
        </SoftCard>
        <SoftCard className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Live for you</div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{grants.length}</p>
          <p className="text-[12px] text-[var(--muted)]">grants on this holder</p>
        </SoftCard>
      </div>

      <SoftCard className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">External debug</h2>
        <ul className="space-y-2 text-sm text-[var(--muted)]">
          {!isAnvil && <li>
            <a className="font-semibold text-[var(--blue)]" href={explorer} target="_blank" rel="noreferrer">
              Avalanche block explorer →
            </a>{' '}
            — transactions and contract state
          </li>}
          {isAnvil && <li>Local Anvil transactions are available through the RPC above. They do not appear on a public explorer. Set your development wallet’s RPC to this endpoint before approving local payments.</li>}
          <li>
            <a className="font-semibold text-[var(--blue)]" href={REGISTRY_DOCS} target="_blank" rel="noreferrer">
              Avalanche Fuji docs →
            </a>
          </li>
        </ul>
      </SoftCard>

      <SoftCard className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Your Registry entities</h2>
          <Link href="/app/mint" className="text-[13px] font-semibold text-[var(--blue)]">
            Create entitlement →
          </Link>
        </div>

        {grants.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-10 text-center">
            <p className="font-medium">No live entitlements yet</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Mint an entitlement for this workspace, then refresh — entity keys appear here for explorer debug.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {grants.map((g) => {
              const ft = features.find((f) => f.id === g.feature);
              const key = g.registry_grant_id;
              return (
                <li key={g.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {featureLabel(g.feature, features)}
                      <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {ft?.value_type === 'boolean' ? 'boolean' : 'numeric'}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--muted)]">
                      Grant <code className="fi-mono">{shortId(g.id)}</code>
                      {' · '}
                      {ft?.value_type === 'boolean' ? 'on' : `${g.remaining} credits`}
                      {' · '}
                      until {new Date(g.paid_through).toLocaleString()}
                    </div>
                    {key ? (
                      <div className="mt-2 break-all fi-mono text-[11px] text-[var(--muted)]">entity {key}</div>
                    ) : (
                      <div className="mt-2 text-[12px] text-[var(--warn)]">No registry_grant_id on this row</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {key ? (
                      <SecondaryButton onClick={() => void copy(key, g.id)}>
                        {copied === g.id ? 'Copied' : 'Copy key'}
                      </SecondaryButton>
                    ) : null}
                    {!isAnvil && g.registry_address && <a
                      href={`${explorer}/address/${g.registry_address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-[13px] font-medium"
                    >
                      Explorer
                    </a>}
                    {!isAnvil && g.payment_tx ? (
                      <a
                        href={`${explorer}/tx/${g.payment_tx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-[13px] font-medium"
                      >
                        Avalanche tx
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SoftCard>

      {msg ? <p className="text-sm text-[var(--deny)]">{msg}</p> : null}
    </div>
  );
}
