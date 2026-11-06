'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi, type Grant, type MumbaiStatus } from '../../../lib/entitlements-client';
import { mandateApi, type MandateOverview, type MandateSummary } from '../../../lib/mandate-client';
import { featureLabel, shortId } from '../../../lib/use-operator';

export default function MandatePage() {
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [mandates, setMandates] = useState<MandateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overview, setOverview] = useState<MandateOverview | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setErr('');
    try {
      const [s, list, live] = await Promise.all([
        entitlementsApi.status().catch(() => null),
        mandateApi.list('owner'),
        entitlementsApi.live().catch(() => ({ grants: [] as Grant[] })),
      ]);
      setStatus(s);
      setGrants(live.grants ?? []);
      const rows = list.mandates ?? [];
      setMandates(rows);
      setSelectedId((prev) => {
        if (prev && rows.some((m) => m.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setOverview(null);
      return;
    }
    let cancelled = false;
    void mandateApi
      .overview(selectedId)
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const dualFeature = status?.dual_gate.feature ?? 'ocr';
  const livingForDual = grants.filter((g) => g.feature === dualFeature && Number(g.remaining) > 0);
  const gateReady = mandates.length > 0 && livingForDual.length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Mandate</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Agent spend ceiling (vault + window + lifetime caps) — ArcenAuth-style money gate. Humans buy access via{' '}
          <Link href="/app/embed" className="font-medium text-[var(--blue)] underline">
            Embed
          </Link>
          ; agents spend only when mandate capacity <em>and</em> a living entitlement both pass.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          gateReady
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-[var(--line)] bg-[var(--soft)] text-[var(--ink2)]'
        }`}
      >
        <div className="font-semibold text-[var(--ink)]">Dual-gate status</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Mandate funded:{' '}
            {mandates.length > 0 ? (
              <span className="font-medium text-[var(--good)]">yes ({mandates.length})</span>
            ) : (
              <span className="font-medium text-[var(--deny)]">no — seed / fund below</span>
            )}
          </li>
          <li>
            Living entitlement for <code className="fi-mono text-xs">{dualFeature}</code>:{' '}
            {livingForDual.length > 0 ? (
              <span className="font-medium text-[var(--good)]">
                yes ({livingForDual.length} · {livingForDual.reduce((a, g) => a + Number(g.remaining), 0)} credits)
              </span>
            ) : (
              <span className="font-medium text-[var(--deny)]">
                no —{' '}
                <Link href="/app/grants?tab=plans" className="underline">
                  sell a plan
                </Link>{' '}
                or{' '}
                <Link href="/app/grants?tab=issue" className="underline">
                  issue access
                </Link>
              </span>
            )}
          </li>
          <li>
            Agent MCP:{' '}
            <Link href="/app/mcp" className="font-medium text-[var(--blue)] underline">
              Connect agent
            </Link>
          </li>
        </ol>
      </div>

      {livingForDual.length > 0 && (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]">
          <h2 className="text-sm font-semibold">Entitlements feeding this gate</h2>
          <ul className="mt-2 divide-y divide-[var(--line)] text-sm">
            {livingForDual.slice(0, 5).map((g) => (
              <li key={g.id} className="flex justify-between gap-3 py-2">
                <span>
                  {featureLabel(g.feature)} · {g.remaining} credits
                </span>
                <span className="fi-mono text-xs text-[var(--muted)]">{shortId(g.id)}</span>
              </li>
            ))}
          </ul>
          <Link href="/app/grants" className="mt-2 inline-block text-sm font-medium text-[var(--blue)] underline">
            All living access →
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Your mandates</h2>
          <button
            type="button"
            onClick={() => void loadList()}
            className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium"
          >
            Refresh
          </button>
        </div>

        {loading && mandates.length === 0 && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {err && <p className="text-sm text-[var(--deny)]">{err}</p>}
        {!loading && mandates.length === 0 && !err && (
          <div className="py-6 text-center text-sm">
            <p className="font-medium">No mandates in the policy DB yet</p>
            <p className="mt-2 text-[var(--muted)]">
              Local Anvil path: run <code className="fi-mono text-xs">pnpm seed:local</code> so a funded BagMandate
              exists. Then agents can spend under dual-gate.
            </p>
          </div>
        )}

        <ul className="divide-y divide-[var(--line)]">
          {mandates.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={`flex w-full items-center justify-between gap-3 py-3 text-left ${selectedId === m.id ? '' : 'opacity-80'}`}
              >
                <div>
                  <div className="font-medium">{shortId(m.id)}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {m.status} · owner {shortId(m.owner_address)} · cap {m.lifetime_cap}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--muted)]">
                  window {m.budget_per_window}
                  <div>per buy ≤ {m.per_purchase_cap}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {overview && (
        <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">Live capacity</h2>
          {overview.onchain_state.status === 'unavailable' && (
            <p className="rounded-xl border border-orange-200 bg-[var(--warn-t)] px-3 py-2 text-sm">
              On-chain state unavailable: {overview.onchain_state.message}. DB terms still shown; drawability is 0 until
              RPC is back.
            </p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vault</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--good)]">{overview.vault_available}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Can draw now</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{overview.can_be_drawn_now}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Window spent</dt>
              <dd className="mt-1 text-lg font-medium tabular-nums">
                {overview.spent_this_window} / {overview.budget_per_window}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Lifetime spent</dt>
              <dd className="mt-1 text-lg font-medium tabular-nums">
                {overview.spent_total} / {overview.lifetime_cap}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Contract</dt>
              <dd className="mt-1 fi-mono text-xs">{overview.terms.contract_address ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Dual-gate feature</dt>
              <dd className="mt-1 fi-mono text-sm">{dualFeature}</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-semibold">Agents on this mandate</h3>
            {overview.agents.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No agents yet — connect via MCP.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--line)] text-sm">
                {overview.agents.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{a.name || shortId(a.id)}</span>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        depth {a.depth} · {a.status} · share {a.share_percent}%
                      </span>
                    </span>
                    <span className="fi-mono text-xs text-[var(--muted)]">{shortId(a.operator_address)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/app/mcp" className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white">
              Connect agent (MCP)
            </Link>
            <Link href="/app/grants" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
              Entitlements
            </Link>
            <Link href="/app/embed" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
              Embed checkout
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
