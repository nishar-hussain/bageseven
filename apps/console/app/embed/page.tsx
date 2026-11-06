'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BagsevenEmbed } from '../../lib/bagseven-sdk-react';
import { EmbedWalletBar } from '../../components/wallet/ConnectWallet';

function EmbedInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const pk = params.get('pk') ?? process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY ?? '';
  const component = params.get('component') ?? params.get('cmp') ?? 'cmp_portal';
  const holder = params.get('holder') ?? undefined;
  const checkoutSessionId = params.get('session') ?? params.get('checkoutSessionId') ?? undefined;
  const heading = params.get('heading') ?? undefined;
  const ctaLabel = params.get('cta') ?? undefined;
  const showPoweredBy = params.get('powered') !== '0';
  const theme = {
    ink: params.get('ink') || undefined,
    accent: params.get('accent') || undefined,
    soft: params.get('soft') || undefined,
    radius: params.get('radius') || undefined,
  };

  if (!token && !pk) {
    return (
      <div className="p-8 text-sm text-[var(--muted)]">
        Missing embed credentials. Pass <code className="fi-mono text-xs">token</code> (customer access token from{' '}
        <code className="fi-mono text-xs">identify</code>) and/or <code className="fi-mono text-xs">pk</code>, plus{' '}
        <code className="fi-mono text-xs">component=cmp_pricing|cmp_checkout|cmp_portal|cmp_customer</code>.
      </div>
    );
  }

  return (
    <div
      className="min-h-screen px-4 py-8 sm:px-8"
      style={{
        background: `linear-gradient(180deg, ${theme.soft || '#f8fafc'} 0%, #ffffff 40%)`,
        ['--bagseven-ink' as string]: theme.ink || '#0f172a',
        ['--bagseven-accent' as string]: theme.accent || '#0f172a',
        ['--bagseven-soft' as string]: theme.soft || '#f8fafc',
        ['--bagseven-radius' as string]: theme.radius || '16px',
      }}
    >
      <BagsevenEmbed
        accessToken={token || undefined}
        publishableKey={pk || undefined}
        apiUrl="/api/public"
        component={component}
        holder={holder}
        checkoutSessionId={checkoutSessionId}
        mode="inline"
        theme={theme}
        heading={heading}
        ctaLabel={ctaLabel || undefined}
        showPoweredBy={showPoweredBy}
        walletSlot={<EmbedWalletBar />}
      />
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
