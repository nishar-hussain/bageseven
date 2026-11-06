'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '../../../components/app/ui';
import { shortId } from '../../../lib/use-operator';

type Bootstrap = {
  worker: string | null;
  ready: boolean;
  tools?: string[];
  cmd?: string;
  cursorMcp?: { mcpServers: Record<string, unknown> };
  auth?: { human: string; agent: string };
};

export default function McpPage() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTech, setShowTech] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/mcp/bootstrap');
    if (!res.ok) throw new Error(res.status === 401 ? 'Sign in first' : `bootstrap ${res.status}`);
    setData((await res.json()) as Bootstrap);
  }, []);

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const ensureWorker = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/mcp/bootstrap', { method: 'POST' });
      if (!res.ok) throw new Error(`bootstrap ${res.status}`);
      const json = (await res.json()) as Bootstrap;
      setData(json);
      setMsg('Agent slot ready — copy the Cursor config or start command.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setMsg(`Copied ${label}`);
  };

  const cursorJson = data?.cursorMcp ? JSON.stringify(data.cursorMcp, null, 2) : '';
  const agentName = data?.worker ? `Agent ${shortId(data.worker)}` : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Connect an agent" description="MCP slot for agents. They never hold World credentials." />

      <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Agent slot</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {agentName ? (
                <>
                  Bound as <strong className="text-[var(--ink)]">{agentName}</strong>
                </>
              ) : (
                'Create a slot, then start MCP locally or point ChatGPT at your HTTPS URL.'
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void ensureWorker()}
            className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {data?.worker ? 'Refresh config' : 'Create agent slot'}
          </button>
        </div>
        {data?.worker && (
          <button
            type="button"
            className="text-xs text-[var(--muted)] underline"
            onClick={() => setShowTech((v) => !v)}
          >
            {showTech ? 'Hide technical id' : 'Show technical id'}
          </button>
        )}
        {showTech && data?.worker && (
          <div className="fi-field">
            <label>Worker UUID (advanced)</label>
            <div className="flex gap-2">
              <input readOnly className="fi-mono text-sm !rounded-xl flex-1" value={data.worker} />
              <button type="button" className="rounded-full border border-[var(--line)] px-3 text-sm" onClick={() => void copy(data.worker!, 'worker id')}>
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      {data?.cmd && (
        <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">1. Start MCP (Cursor / Claude)</h2>
          <pre className="fi-mono overflow-auto rounded-xl bg-[var(--hero)] p-4 text-xs text-white/85">{data.cmd}</pre>
          <button type="button" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium" onClick={() => void copy(data.cmd!, 'start command')}>
            Copy start command
          </button>
          <p className="text-sm text-[var(--muted)]">
            Or from repo root: <code className="fi-mono text-xs">pnpm mcp:local</code>
          </p>
        </section>
      )}

      {cursorJson && (
        <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">2. Paste into Cursor MCP settings</h2>
          <pre className="fi-mono overflow-auto rounded-xl border border-[var(--line)] bg-[var(--soft)] p-4 text-xs">{cursorJson}</pre>
          <button type="button" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium" onClick={() => void copy(cursorJson, 'Cursor MCP JSON')}>
            Copy JSON
          </button>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">What the agent can call</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {(
            data?.tools ?? [
              'bagseven_status',
              'grant_status',
              'paid_run',
              'mint_with_world',
              'buy_credits',
              'cancel_renewal',
              'explain_denial',
              'bagseven_fetch',
            ]
          ).map((t) => (
            <li key={t} className="rounded-xl border border-[var(--line)] bg-[var(--soft)] px-3 py-2">
              <code className="fi-mono text-xs text-[var(--ink)]">{t}</code>
              {t === 'paid_run' && <div className="mt-1 text-xs text-[var(--muted)]">Pass feature=ocr — no grant UUID needed</div>}
              {t === 'grant_status' && <div className="mt-1 text-xs text-[var(--muted)]">Lists living OCR entitlements</div>}
            </li>
          ))}
        </ul>
        <p className="text-sm text-[var(--muted)]">
          Mint first on{' '}
          <Link href="/app/mint" className="font-semibold text-[var(--blue)] underline">
            Mint access
          </Link>
          , then ask the agent to run OCR / check status.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">ChatGPT</h2>
        <p className="text-sm text-[var(--muted)]">
          Tunnel <code className="fi-mono text-xs">:4009/mcp</code> over HTTPS, enable OAuth (
          <code className="fi-mono text-xs">MCP_OAUTH_REQUIRED</code>), add the custom MCP plugin. You complete World on
          Bagseven&apos;s authorize page; ChatGPT only stores a Bagseven token.
        </p>
        <Link href="/app" className="inline-block text-sm font-semibold text-[var(--blue)] underline">
          Back to overview →
        </Link>
      </section>

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
