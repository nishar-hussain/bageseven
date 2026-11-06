'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BagsevenEmbed } from '@bagseven/sdk/react';

function CheckoutInner() {
  const params = useSearchParams();
  const session = params.get('session') ?? '';
  if (!session) {
    return <div className="p-8 text-sm text-[var(--muted)]">Missing checkout session id. Open one from /app/checkouts.</div>;
  }
  return (
    <div className="min-h-screen bg-white p-6">
      <BagsevenEmbed apiUrl="/api/public" checkoutSessionId={session} initialView="checkout" mode="inline" />
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--muted)]">Loading checkout…</div>}>
      <CheckoutInner />
    </Suspense>
  );
}
