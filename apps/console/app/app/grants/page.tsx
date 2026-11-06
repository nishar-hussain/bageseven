'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GrantList } from '../../../components/app/GrantList';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard } from '../../../components/app/ui';
import type { Grant } from '../../../lib/entitlements-client';
import { featureLabel, shortId } from '../../../lib/use-operator';

export default function GrantsPage() {
  const [selected, setSelected] = useState<Grant | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Entitlements"
        description={
          <>
            Credits + TTL. Agents also need a{' '}
            <Link href="/app/mandate" className="font-medium text-[var(--blue)] underline decoration-dotted underline-offset-2">
              mandate
            </Link>
            .
          </>
        }
        action={<PrimaryButton href="/app/mint">Create</PrimaryButton>}
      />

      <GrantList selectable selectedId={selected?.id} onSelect={setSelected} />

      {selected ? (
        <SoftCard className="space-y-3 p-5">
          <h2 className="text-[15px] font-semibold">Selected</h2>
          <p className="text-[13px] text-[var(--muted)]">
            {featureLabel(selected.feature)} · {selected.remaining} credits · {shortId(selected.id)}
          </p>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton href="/app/mandate">View mandate</PrimaryButton>
            <SecondaryButton href="/app/mint">Create another</SecondaryButton>
            <SecondaryButton href="/app/mcp">Connect agent</SecondaryButton>
          </div>
        </SoftCard>
      ) : null}
    </div>
  );
}
