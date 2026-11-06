'use client';

import { useEffect, useState } from 'react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi, type MumbaiStatus } from '../../../lib/entitlements-client';

export default function SettingsPage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    entitlementsApi
      .status()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Tracks</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Live vs mock from server env — secrets never in the browser.</p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--deny)]">{error}</p>}

      {status && (
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              t: 'World',
              lines: [`Mode: ${status.tracks.world.mode}`, `Mock proofs: ${status.tracks.world.mock_proofs}`],
              tip: 'Live: WORLD_CLIENT_ID + id_token on Mint.',
            },
            {
              t: 'Hedera',
              lines: [
                `Network: ${status.tracks.hedera.network}`,
                `Facilitator: ${status.tracks.hedera.facilitator}`,
                `Demo settle: ${status.tracks.hedera.demo_settle}`,
              ],
              tip: 'Live: HEDERA_X402_FACILITATOR_URL or real payment_tx.',
            },
            {
              t: 'Arkiv',
              lines: [`Store: ${status.tracks.arkiv.store}`, `Live entities: ${status.tracks.arkiv.live}`],
              tip: 'Live: ARKIV_ACCESS_KEY + ARKIV_PRIVATE_KEY, restart daemon.',
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
              <p className="mt-3 text-xs text-[var(--muted)]">{c.tip}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-[var(--blue)] p-5 text-sm text-white shadow-[var(--sh)]">
        Dual-gate feature=<code className="fi-mono text-xs">{status?.dual_gate.feature ?? '…'}</code>
        {' · '}
        require_grant={String(status?.dual_gate.require_grant ?? '…')}
        <div className="mt-2 text-white/75">See design.md · SETUP.md · arkiv/schema.md</div>
      </div>
    </div>
  );
}
