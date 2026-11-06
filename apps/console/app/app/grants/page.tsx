'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GrantList } from '../../../components/app/GrantList';
import { StatusBadges } from '../../../components/app/StatusBadges';
import type { Grant } from '../../../lib/entitlements-client';
import { featureLabel, shortId } from '../../../lib/use-operator';

export default function GrantsPage() {
  const [selected, setSelected] = useState<Grant | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Entitlements</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Living feature access (credits + TTL). Agents also need a funded{' '}
          <Link href="/app/mandate" className="font-medium text-[var(--blue)] underline">
            mandate
          </Link>{' '}
          for dual-gate spend.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--soft)] px-4 py-3 text-sm text-[var(--ink2)]">
        <strong className="text-[var(--ink)]">Feature</strong> → <strong className="text-[var(--ink)]">Entitlement</strong> →{' '}
        <strong className="text-[var(--ink)]">Mandate</strong> spend ceiling → agent MCP
      </div>

      <GrantList selectable selectedId={selected?.id} onSelect={setSelected} />

      {selected && (
        <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">Selected</h2>
          <p className="text-sm text-[var(--muted)]">
            {featureLabel(selected.feature)} · {selected.remaining} credits · {shortId(selected.id)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/mandate" className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white">
              View mandate
            </Link>
            <Link href="/app/mint" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
              Create another
            </Link>
            <Link href="/app/mcp" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
              Connect agent
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
