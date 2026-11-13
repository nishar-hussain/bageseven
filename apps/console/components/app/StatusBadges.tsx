'use client';

import { useEffect, useState } from 'react';
import { entitlementsApi, type MumbaiStatus } from '../../lib/entitlements-client';

export function StatusBadges() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void entitlementsApi
      .status()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="border border-[var(--deny)]/30 bg-[var(--deny)]/5 px-4 py-3 text-sm text-[var(--deny)]">
        Daemon unreachable via BFF — start `pnpm start:local`. {error}
      </div>
    );
  }
  if (!status) return <div className="text-sm text-[var(--muted)]">Loading track status…</div>;

  const badges = [
    { label: 'Account', value: 'Email + wallet', live: true },
    {
      label: 'Avalanche',
      value: status.tracks.avalanche.demo_settle ? 'Settle off' : status.tracks.avalanche.network,
      live: !status.tracks.avalanche.demo_settle,
    },
    { label: 'Registry', value: status.tracks.registry.live ? 'Live' : 'Local store', live: status.tracks.registry.live },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((b) => (
        <span key={b.label} className={`fi-badge ${b.live ? 'fi-badge-live' : 'fi-badge-warn'}`}>
          {b.label}: {b.value}
        </span>
      ))}
      <span className="fi-mono text-xs text-[var(--muted)]">
        dual-gate · feature={status.dual_gate.feature} · require={String(status.dual_gate.require_grant)}
      </span>
    </div>
  );
}
