'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BagsevenEmbed,
  BagsevenProvider,
  FeatureFlagGuard,
  useBagseven,
  useEntitlement,
  useFlag,
} from '@bagseven/sdk/react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { useOperator } from '../../../lib/use-operator';

const PK = process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY ?? '';

function IdentifyOnMount({ holder }: { holder: string }) {
  const { identify } = useBagseven();
  useEffect(() => {
    identify({ holder });
  }, [holder, identify]);
  return null;
}

function LiveGuard() {
  const enabled = useFlag('ocr');
  const ent = useEntitlement('ocr');
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--soft)] p-4 text-sm">
      <div>
        <code className="fi-mono text-xs">useFlag(&apos;ocr&apos;)</code> → <strong>{String(enabled)}</strong>
      </div>
      <div className="mt-1">
        remaining {ent.remaining} · TTL {ent.paid_through ?? 'none'}
      </div>
      <FeatureFlagGuard feature="ocr" fallback={<p className="mt-2 text-[var(--muted)]">OCR gated off — mint an entitlement first.</p>}>
        <p className="mt-2 font-medium text-[var(--good)]">OCR is entitled. FeatureFlagGuard rendered this.</p>
      </FeatureFlagGuard>
    </div>
  );
}

export default function SdkPage() {
  const op = useOperator();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const issue = useCallback(async () => {
    setMsg('');
    const res = await fetch('/api/embed-token', { method: 'POST' });
    const json = (await res.json()) as { token?: string; error?: { message?: string } };
    if (!res.ok || !json.token) {
      setMsg(json.error?.message ?? `token ${res.status}`);
      return;
    }
    setToken(json.token);
  }, []);

  useEffect(() => {
    if (op.holder) void issue();
  }, [op.holder, issue]);

  const snippet = `import { BagsevenProvider, FeatureFlagGuard, BagsevenEmbed } from "@bagseven/sdk/react";

<BagsevenProvider publishableKey="${PK || 'pk_test_…'}">
  <FeatureFlagGuard feature="ocr"><OcrButton /></FeatureFlagGuard>
  <BagsevenEmbed accessToken={token} initialView="portal" />
  <BagsevenEmbed checkoutSessionId={cs} initialView="checkout" />
</BagsevenProvider>`;

  const iframe = `<iframe src="${origin}/embed?token=…" style="border:0;width:100%;min-height:420px"></iframe>`;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Entitlement SDK</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Schematic-style check / consume / embed for humans. Agents use the same verbs over MCP.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {msg && <p className="text-sm text-[var(--deny)]">{msg}</p>}

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Drop into your app</h2>
        <pre className="overflow-auto rounded-xl bg-[var(--hero)] p-4 font-mono text-xs text-white/90">{snippet}</pre>
        <p className="text-xs text-[var(--muted)]">Iframe embed (token from identify / this page):</p>
        <pre className="overflow-auto rounded-xl border border-[var(--line)] bg-[var(--soft)] p-3 font-mono text-xs">{iframe}</pre>
        <button type="button" onClick={() => void issue()} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
          Refresh embed token
        </button>
      </section>

      {op.holder && (
        <BagsevenProvider publishableKey={PK || 'pk_local'} accessToken={token || undefined}>
          <IdentifyOnMount holder={op.holder} />
          <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
            <h2 className="text-base font-semibold">Live hooks</h2>
            <LiveGuard />
          </section>
          {token ? (
            <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
              <h2 className="text-base font-semibold">BagsevenEmbed</h2>
              <BagsevenEmbed accessToken={token} apiUrl="/api/public" initialView="portal" />
            </section>
          ) : null}
        </BagsevenProvider>
      )}
    </div>
  );
}
