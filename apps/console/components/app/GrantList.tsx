'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { entitlementsApi, type Grant } from '../../lib/entitlements-client';

function useTtl(paidThrough: string) {
  const [label, setLabel] = useState('…');
  const [dead, setDead] = useState(false);
  useEffect(() => {
    const tick = () => {
      const ms = new Date(paidThrough).getTime() - Date.now();
      if (ms <= 0) {
        setLabel('evaporated');
        setDead(true);
        return;
      }
      setDead(false);
      const s = Math.ceil(ms / 1000);
      const m = Math.floor(s / 60);
      setLabel(m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [paidThrough]);
  return { label, dead };
}

function GrantRow({ grant, network }: { grant: Grant; network: string }) {
  const { label, dead } = useTtl(grant.paid_through);
  const hashscan = grant.payment_tx
    ? `https://hashscan.io/${network}/transaction/${encodeURIComponent(grant.payment_tx)}`
    : null;
  return (
    <div className="border-t border-[var(--line)] py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{grant.feature}</div>
          <div className="fi-mono text-xs text-[var(--muted)]">{grant.id}</div>
        </div>
        <div className={`text-2xl tracking-tight ${dead ? 'text-[var(--deny)]' : 'text-[var(--good)]'}`}>{label}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
        <span>
          remaining <strong className="text-[var(--ink)]">{grant.remaining}</strong>
        </span>
        <span>renewal {grant.renewal_enabled ? 'on' : 'OFF'}</span>
        {grant.arkiv_entity_key && (
          <span className="fi-mono max-w-[12rem] truncate">entity {grant.arkiv_entity_key.slice(0, 14)}…</span>
        )}
        {hashscan && (
          <a className="font-medium text-[var(--blue)] underline" href={hashscan} target="_blank" rel="noreferrer">
            HashScan
          </a>
        )}
      </div>
    </div>
  );
}

export function GrantList({ feature, holder }: { feature?: string; holder?: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [network, setNetwork] = useState('testnet');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, live] = await Promise.all([
        entitlementsApi.status().catch(() => null),
        entitlementsApi.live({ feature, holder }),
      ]);
      if (status?.tracks.hedera.network) setNetwork(status.tracks.hedera.network);
      setGrants(live.grants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [feature, holder]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Living grants</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--soft)]"
        >
          Refresh
        </button>
      </div>
      {loading && grants.length === 0 && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {error && <p className="text-sm text-[var(--deny)]">{error}</p>}
      {!loading && !error && grants.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-[var(--muted)]">No living grant on the query surface.</p>
          <Link href="/app/mint" className="mt-5 inline-flex rounded-full bg-[var(--ink)] px-5 py-2 text-sm font-semibold text-white">
            Mint with World first
          </Link>
        </div>
      )}
      {grants.map((g) => (
        <GrantRow key={g.id} grant={g} network={network} />
      ))}
    </div>
  );
}
