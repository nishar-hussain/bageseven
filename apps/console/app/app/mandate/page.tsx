'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi, type MumbaiStatus } from '../../../lib/entitlements-client';

export default function MandatePage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    void entitlementsApi
      .status()
      .then(setStatus)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Mandate</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Policy spend ceiling (<code className="fi-mono text-xs">SIGNER_MODE=dev</code>). Access side is Arkiv entitlements.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Live dual-gate</h2>
        {err ? (
          <p className="mt-2 text-sm text-[var(--deny)]">{err}</p>
        ) : !status ? (
          <p className="mt-2 text-sm text-[var(--muted)]">Loading track status…</p>
        ) : (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Require grant</dt>
              <dd className="mt-1 font-medium">{status.dual_gate.require_grant ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Feature SKU</dt>
              <dd className="mt-1 fi-mono text-sm">{status.dual_gate.feature}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Arkiv store</dt>
              <dd className="mt-1 font-medium">{status.tracks.arkiv.live ? 'Live entities' : 'Memory fallback'}</dd>
            </div>
          </dl>
        )}
        <p className="mt-4 text-sm text-[var(--muted)]">
          Mandate = money ceiling for the worker. Living grant = access clock. Paid agent tools need both.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {[
          { t: '1. Mint access', d: 'World mint → living Arkiv grant with TTL.', href: '/app/mint', cta: 'Go to mint' },
          { t: '2. Settle payment', d: 'Hedera buy_credits stamps HashScan payment_tx.', href: '/app/credits', cta: 'Buy credits' },
          { t: '3. Bind MCP', d: 'Worker-bound tools under dual-gate.', href: '/app/mcp', cta: 'MCP setup' },
          { t: '4. Overview', d: 'Living grants, TTL, paid run.', href: '/app', cta: 'Open overview' },
        ].map((x) => (
          <div key={x.t} className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
            <div className="mb-3 h-1 w-10 rounded-full bg-[var(--blue)]" />
            <h2 className="text-base font-semibold">{x.t}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{x.d}</p>
            <Link href={x.href} className="mt-4 inline-block text-sm font-semibold text-[var(--blue)] underline">
              {x.cta} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
