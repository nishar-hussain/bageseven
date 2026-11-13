'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BagsevenEmbed } from '../../lib/bagseven-sdk-react';
import { EmbedWalletBar } from '../../components/wallet/ConnectWallet';
import { designProps, validateDesign, type DesignConfig } from '../../lib/builder-model';
import { embedAuthMessage, parentOrigin } from '../../lib/embed-auth-message';

function EmbedInner() {
  const params = useSearchParams();
  const design = params.get('design');
  const [published, setPublished] = useState<DesignConfig | null>(null);
  const [error, setError] = useState('');
  const [customer, setCustomer] = useState<{ token: string; holder: string; checkoutSessionId?: string } | null>(null);
  const parent = parentOrigin(params.get('parent'));
  useEffect(() => {
    if (!design) return;
    let cancelled = false; setPublished(null); setError('');
    void fetch(`/api/embed-designs/${encodeURIComponent(design)}`, { cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'Page unavailable.');
      if (!cancelled) setPublished(validateDesign(body.config));
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Page unavailable.'); });
    return () => { cancelled = true; };
  }, [design]);
  useEffect(() => {
    if (!design || !parent || window.parent === window) return;
    const receive = (event: MessageEvent) => { const authorized = embedAuthMessage(event, parent, window.parent); if (authorized) setCustomer(authorized); };
    window.addEventListener('message', receive);
    const ready = () => window.parent.postMessage({ type: 'bagseven:ready' }, parent);
    ready(); const timer = setInterval(ready, 14 * 60000);
    return () => { window.removeEventListener('message', receive); clearInterval(timer); };
  }, [design, parent]);
  const token = design ? customer?.token ?? '' : params.get('token') ?? '';
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

  if (design) {
    if (error) return <div role="alert" className="p-8 text-sm text-[var(--muted)]">{error}</div>;
    if (!published) return <div className="p-8 text-sm text-[var(--muted)]" aria-busy="true">Loading billing…</div>;
    return <div className="min-h-screen p-4 sm:p-8" style={{ background: published.soft }}>
      {!customer && <p className="mb-5 text-xs text-[var(--muted)]">Connect your customer account through the host app to enable checkout and account management.</p>}
      <BagsevenEmbed {...designProps(published)} accessToken={token || undefined} holder={customer?.holder}
        publishableKey={pk || undefined} apiUrl="/api/public" checkoutSessionId={customer?.checkoutSessionId} />
    </div>;
  }

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
