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

  const worldLive =
    status.tracks.world.mode === 'idkit' ||
    status.tracks.world.mode === 'agent_pass' ||
    status.tracks.world.mode === 'dual' ||
    status.tracks.world.mode === 'live' ||
    status.tracks.world.mode === 'oidc';
  const worldLabel =
    status.tracks.world.mode === 'unconfigured'
      ? 'Not configured'
      : status.tracks.world.mode === 'dual'
      ? 'IDKit+AgentPass'
      : status.tracks.world.mode === 'idkit'
        ? 'IDKit'
        : status.tracks.world.mode === 'agent_pass'
          ? 'Agent Pass'
          : status.tracks.world.mode === 'live' || status.tracks.world.mode === 'oidc'
            ? 'Live'
            : 'Mock';
  const badges = [
    { label: 'World', value: worldLabel, live: worldLive },
    {
      label: 'Whitechain',
      value: status.tracks.whitechain.demo_settle ? 'Demo settle' : status.tracks.whitechain.network,
      live: !status.tracks.whitechain.demo_settle,
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
