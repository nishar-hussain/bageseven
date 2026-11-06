'use client';

import { useEffect, useState } from 'react';
import { entitlementsApi, type MumbaiStatus } from '../../lib/entitlements-client';

export function StatusBadges() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    entitlementsApi
      .status()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
    { label: 'World', value: status.tracks.world.mode === 'live' ? 'Live' : 'Mock', live: status.tracks.world.mode === 'live' },
    {
      label: 'Hedera',
      value: status.tracks.hedera.facilitator ? 'Facilitator' : status.tracks.hedera.demo_settle ? 'Demo settle' : 'Configured',
      live: status.tracks.hedera.facilitator,
    },
    { label: 'Arkiv', value: status.tracks.arkiv.live ? 'Live' : 'Memory', live: status.tracks.arkiv.live },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((b) => (
        <span key={b.label} className={`fi-badge ${b.live ? 'fi-badge-live' : 'fi-badge-mock'}`}>
          {b.label}: {b.value}
        </span>
      ))}
      <span className="fi-mono text-xs text-[var(--muted)]">
        dual-gate · feature={status.dual_gate.feature} · require={String(status.dual_gate.require_grant)}
      </span>
    </div>
  );
}
