'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BagsevenEmbed } from '@bagseven/sdk/react';

function EmbedInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  if (!token) {
    return (
      <div className="p-8 text-sm text-[var(--muted)]">
        Missing embed token. Issue one with the Node SDK <code>identify({`{ holder }` })</code> or the dashboard SDK page.
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-white p-6">
      <BagsevenEmbed accessToken={token} apiUrl="/api/public" initialView="portal" mode="inline" />
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--muted)]">Loading embed…</div>}>
      <EmbedInner />
    </Suspense>
  );
}
