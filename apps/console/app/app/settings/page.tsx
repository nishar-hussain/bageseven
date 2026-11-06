'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
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
          id: 'world',
          ok: Boolean(status.tracks.world.idkit) && !status.tracks.world.mock_proofs,
          title: 'World IDKit (login + mint uniqueness)',
          need: status.tracks.world.mock_proofs
            ? 'Set WORLD_MOCK_PROOFS=false and restart. You already have APP_ID / RP_ID / signing key.'
            : status.tracks.world.idkit
              ? 'Live — scan World App on login / mint.'
              : 'Set WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY (+ NEXT_PUBLIC_* mirrors).',
          action: '/app/login',
        },
        {
          id: 'whitechain',
          ok: status.tracks.whitechain.operator || !status.tracks.whitechain.demo_settle,
          title: 'Whitechain USDT (money clock)',
          need: status.tracks.whitechain.demo_settle
            ? 'Buyer wallet pay works with demo confirm until you set WHITECHAIN_DEMO_SETTLE=false, WHITECHAIN_PAY_TO, WHITECHAIN_USDT. Operator Credits also need WHITECHAIN_PRIVATE_KEY.'
            : 'Live settle path configured.',
          action: '/app/checkouts',
        },
        {
          id: 'arkiv',
          ok: status.tracks.arkiv.live,
          title: 'Arkiv living grants',
          need: status.tracks.arkiv.live
            ? 'Live store — grants are queryable entities.'
            : 'Set ARKIV_ACCESS_KEY + ARKIV_PRIVATE_KEY and ENTITLEMENT_STORE=arkiv.',
          action: '/app/grants',
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Tracks</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Live vs mock from server env — secrets never in the browser. Full checklist:{' '}
          <code className="fi-mono text-xs">docs/LIVE.md</code>
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--deny)]">{error}</p>}

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
              t: 'World',
              lines: [
                `Mode: ${status.tracks.world.mode}`,
                `Mock proofs: ${status.tracks.world.mock_proofs}`,
                `IDKit: ${Boolean(status.tracks.world.idkit)}`,
                `Agent Pass: ${Boolean(status.tracks.world.agent_pass)}`,
              ],
            },
            {
              t: 'Whitechain',
              lines: [
                `Network: ${status.tracks.whitechain.network} (${status.tracks.whitechain.chain_id})`,
                `Operator: ${status.tracks.whitechain.operator}`,
                `Demo settle: ${status.tracks.whitechain.demo_settle}`,
              ],
            },
            {
              t: 'Arkiv',
              lines: [`Store: ${status.tracks.arkiv.store}`, `Live entities: ${status.tracks.arkiv.live}`],
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
