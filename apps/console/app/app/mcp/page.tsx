'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';

export default function McpPage() {
  const [worker, setWorker] = useState('');
  const cmd = worker.trim()
    ? `BAGSEVEN_MCP_WORKER=${worker.trim()} BAGSEVEN_MCP_PORT=4009 DAEMON_URL=http://127.0.0.1:4001 pnpm bagseven-mcp`
    : 'BAGSEVEN_MCP_WORKER=<uuid> BAGSEVEN_MCP_PORT=4009 DAEMON_URL=http://127.0.0.1:4001 pnpm bagseven-mcp';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">MCP</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Agent connection — dual-gate on mandate + living grant.</p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="fi-field">
          <label htmlFor="worker">Worker UUID</label>
          <input
            id="worker"
            className="fi-mono text-sm !rounded-xl"
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        <pre className="fi-mono overflow-auto rounded-xl bg-[var(--hero)] p-4 text-xs text-white/85">{cmd}</pre>
        <button
          type="button"
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium"
          onClick={() => void navigator.clipboard.writeText(cmd)}
        >
          Copy start command
        </button>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
          <li>Tools: grant_status, mint_with_world, buy_credits, paid_run, explain_denial, bagseven_fetch</li>
          <li>
            Feature SKU: <code className="fi-mono text-xs">ocr</code>
          </li>
        </ul>
        <Link href="/app" className="inline-block text-sm font-semibold text-[var(--blue)] underline">
          Back to overview →
        </Link>
      </div>
    </div>
  );
}
