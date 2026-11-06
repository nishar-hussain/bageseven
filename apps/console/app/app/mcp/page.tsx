'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';

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
      setMsg('Worker ready — copy Cursor config or start command below.');
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">MCP</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          How external agents (Cursor, Claude, etc.) spend under your mandate + living grant.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Auth model (important)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--muted)]">
          <li>
            <strong className="text-[var(--ink)]">Human</strong> signs into the dashboard (magic link). Mint / buy credits
            go through <strong className="text-[var(--ink)]">World</strong> (mock proof locally, or real{' '}
            <code className="fi-mono text-xs">id_token</code> when live).
          </li>
          <li>
            <strong className="text-[var(--ink)]">Agent</strong> does <em>not</em> log in with World ID. It connects via
            MCP bound to one worker UUID. Daemon auth is <code className="fi-mono text-xs">DAEMON_AUTH_TOKEN</code> from{' '}
            <code className="fi-mono text-xs">.env</code>.
          </li>
          <li>
            Every paid tool still hits the <strong className="text-[var(--ink)]">dual-gate</strong>: mandate ceiling +
            living Arkiv grant. No grant → refuse (explain_denial).
          </li>
        </ol>
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Worker bind</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">One MCP process ↔ one worker id.</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void ensureWorker()}
            className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {data?.worker ? 'Refresh config' : 'Create worker + config'}
          </button>
        </div>
        <div className="fi-field">
          <label>Worker UUID</label>
          <input
            readOnly
            className="fi-mono text-sm !rounded-xl"
            value={data?.worker ?? ''}
            placeholder="Click Create worker…"
          />
        </div>
        {data?.worker && (
          <button
            type="button"
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium"
            onClick={() => void copy(data.worker!, 'worker UUID')}
          >
            Copy UUID
          </button>
        )}
      </section>

      {data?.cmd && (
        <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">1. Start MCP locally</h2>
          <pre className="fi-mono overflow-auto rounded-xl bg-[var(--hero)] p-4 text-xs text-white/85">{data.cmd}</pre>
          <button
            type="button"
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium"
            onClick={() => void copy(data.cmd!, 'start command')}
          >
            Copy start command
          </button>
          <p className="text-sm text-[var(--muted)]">
            Or from repo root after worker is in <code className="fi-mono text-xs">.env</code>:{' '}
            <code className="fi-mono text-xs">pnpm mcp:local</code>
          </p>
        </section>
      )}

      {cursorJson && (
        <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">2. Cursor / Claude MCP config</h2>
          <p className="text-sm text-[var(--muted)]">
            Paste into Cursor MCP settings (or Claude Desktop). Put the real{' '}
            <code className="fi-mono text-xs">DAEMON_AUTH_TOKEN</code> from <code className="fi-mono text-xs">.env</code>{' '}
            into <code className="fi-mono text-xs">env</code> — never commit it.
          </p>
          <pre className="fi-mono overflow-auto rounded-xl border border-[var(--line)] bg-[var(--soft)] p-4 text-xs">
            {cursorJson}
          </pre>
          <button
            type="button"
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium"
            onClick={() => void copy(cursorJson, 'Cursor MCP JSON')}
          >
            Copy JSON
          </button>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">Tools the agent gets</h2>
        <ul className="grid gap-1 text-sm text-[var(--muted)] sm:grid-cols-2">
          {(
            data?.tools ?? [
              'bagseven_status',
              'bagseven_search',
              'bagseven_fetch',
              'grant_status',
              'mint_with_world',
              'buy_credits',
              'paid_run',
              'cancel_renewal',
              'explain_denial',
            ]
          ).map((t) => (
            <li key={t} className="fi-mono text-xs text-[var(--ink)]">
              {t}
            </li>
          ))}
        </ul>
        <p className="text-sm text-[var(--muted)]">
          Feature SKU: <code className="fi-mono text-xs">ocr</code>. Mint first on{' '}
          <Link href="/app/mint" className="font-semibold text-[var(--blue)] underline">
            Mint
          </Link>
          , then agent <code className="fi-mono text-xs">paid_run</code>.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <h2 className="text-base font-semibold">ChatGPT / remote MCP</h2>
        <p className="text-sm text-[var(--muted)]">
          ChatGPT does <strong className="text-[var(--ink)]">not</strong> connect to localhost stdio. Expose{' '}
          <code className="fi-mono text-xs">:4009/mcp</code> over HTTPS (<code className="fi-mono text-xs">BAGSEVEN_MCP_PUBLIC_URL</code>
          ), set <code className="fi-mono text-xs">MCP_OAUTH_REQUIRED=true</code>, tunnel only that port, then Plugins →
          Add custom MCP server. World proves the human on Bagseven&apos;s authorize page; ChatGPT receives a Bagseven
          access token. Details: repo <code className="fi-mono text-xs">AGENTS.md</code>.
        </p>
        <Link href="/app" className="inline-block text-sm font-semibold text-[var(--blue)] underline">
          Back to overview →
        </Link>
      </section>

      {msg && <p className="fi-mono text-xs text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
