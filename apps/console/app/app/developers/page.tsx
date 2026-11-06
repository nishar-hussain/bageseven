'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, PrimaryButton, SoftCard, StatusPill } from '../../../components/app/ui';

type Creds = {
  publishable_key: string | null;
  secret_key: string | null;
  secret_key_hint: string | null;
  embed_base_path: string;
  public_api_path: string;
  components: Array<{ id: string; label: string; blurb: string }>;
  notes: string[];
};

export default function DevelopersPage() {
  const [creds, setCreds] = useState<Creds | null>(null);
  const [revealSk, setRevealSk] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/developer/credentials');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `credentials ${res.status}`);
    setCreds(json);
  }, []);

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Developers"
        description="Credentials for your merchant platform — same model as Schematic / Stripe keys."
        action={<PrimaryButton href="/app/builder">Open Builder</PrimaryButton>}
      />

      {msg ? <p className="text-sm text-[var(--deny)]">{msg}</p> : null}

      <SoftCard className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">API keys</h2>
          <StatusPill tone="good">Provider</StatusPill>
        </div>
        <p className="text-[13px] text-[var(--muted)]">
          Drop these into your app. Publishable in the browser; secret only on your server when you{' '}
          <code className="fi-mono text-xs">identify</code> a customer or create plans.
        </p>

        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--soft)]/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Publishable key</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="fi-mono break-all text-[12px]">{creds?.publishable_key || 'Not configured — set BAGSEVEN_PUBLISHABLE_KEY'}</code>
              {creds?.publishable_key ? (
                <button
                  type="button"
                  className="text-[12px] font-semibold text-[var(--blue)]"
                  onClick={() => void copy('pk', creds.publishable_key!)}
                >
                  {copied === 'pk' ? 'Copied' : 'Copy'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--soft)]/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Secret key</div>
              <button type="button" className="text-[12px] font-semibold text-[var(--blue)]" onClick={() => setRevealSk((v) => !v)}>
                {revealSk ? 'Hide' : 'Reveal'}
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="fi-mono break-all text-[12px]">
                {revealSk ? creds?.secret_key || '—' : creds?.secret_key_hint || 'Not configured'}
              </code>
              {revealSk && creds?.secret_key ? (
                <button
                  type="button"
                  className="text-[12px] font-semibold text-[var(--blue)]"
                  onClick={() => void copy('sk', creds.secret_key!)}
                >
                  {copied === 'sk' ? 'Copied' : 'Copy'}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[12px] text-[var(--muted)]">Never ship sk_ in frontend bundles or mobile apps.</p>
          </div>
        </div>
      </SoftCard>

      <SoftCard className="space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">Embed components</h2>
        <p className="text-[13px] text-[var(--muted)]">
          Render with <code className="fi-mono text-xs">&lt;BagsevenEmbed component=&quot;…&quot; /&gt;</code> or{' '}
          <code className="fi-mono text-xs">/embed?component=…</code>. Configure in{' '}
          <Link href="/app/builder" className="font-semibold text-[var(--blue)]">
            Builder
          </Link>
          .
        </p>
        <ul className="space-y-2">
          {(creds?.components ?? []).map((c) => (
            <li key={c.id} className="rounded-xl border border-[var(--line)] px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{c.label}</span>
                <code className="fi-mono text-[11px] text-[var(--muted)]">{c.id}</code>
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--muted)]">{c.blurb}</p>
            </li>
          ))}
        </ul>
      </SoftCard>

      <SoftCard className="space-y-2 p-5">
        <h2 className="text-[15px] font-semibold">Server snippet</h2>
        <pre className="overflow-auto rounded-xl bg-[var(--hero)] p-4 font-mono text-[11px] leading-relaxed text-white/90">{`import { BagsevenClient } from "@bagseven/sdk/node";

const client = new BagsevenClient({
  apiKey: process.env.BAGSEVEN_SECRET_KEY!,
  baseUrl: process.env.BAGSEVEN_API_URL || "http://127.0.0.1:4001",
});

// After your user signs in:
const { token } = await client.identify({ holder: user.id });
// Pass token + publishable key to BagsevenEmbed / iframe`}</pre>
      </SoftCard>
    </div>
  );
}
