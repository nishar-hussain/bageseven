'use client';

import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';

export default function MandatePage() {
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
