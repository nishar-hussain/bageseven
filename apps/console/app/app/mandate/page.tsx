'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SpendingControls } from '../../../components/app/SpendingControls';
import { PageHeader } from '../../../components/app/ui';
import { entitlementsApi, type Grant } from '../../../lib/entitlements-client';
import { mandateApi, type MandateOverview, type MandateSummary } from '../../../lib/mandate-client';
import { featureLabel, shortId } from '../../../lib/use-operator';

export default function MandatePage() {
  const [revision, setRevision] = useState(0);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [mandates, setMandates] = useState<MandateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overview, setOverview] = useState<MandateOverview | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setErr('');
    try {
      const [list, live] = await Promise.all([
        mandateApi.list('owner'),
        entitlementsApi.live().catch(() => ({ grants: [] as Grant[] })),
      ]);
      setRevision(n => n + 1);
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
  }, [selectedId, revision]);

  const dualFeature = 'ocr';
  const livingForDual = grants.filter((g) => g.feature === dualFeature && Number(g.remaining) > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Agent spending permissions" description="Set USDT budgets for automated purchases. Prepaid service access is managed separately." />

      <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm">
        <p className="font-semibold">Prepaid access and new payments are separate</p>
        <p className="mt-2 text-[var(--muted)]">Agents use active entitlements and remaining credits through MCP without funding a mandate. Set up a spending permission below only when an agent should make new USDT payments automatically.</p>
        <Link href="/app/grants" className="mt-2 inline-block font-medium text-[var(--blue)] underline">Manage service access</Link>
      </div>

      {livingForDual.length > 0 && (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]">
          <h2 className="text-sm font-semibold">Prepaid service access</h2>
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
          <h2 className="text-base font-semibold">Your spending permissions</h2>
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
            <p className="font-medium">No agent spending permissions yet</p>
            <p className="mt-2 text-[var(--muted)]">
              Create a permission to authorize new agent payments. You can already use any active prepaid entitlement.
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

      <SpendingControls selectedId={selectedId} overview={overview} onChange={loadList} onCreated={setSelectedId} />

      {overview?.mandate_id === selectedId && overview && (
        <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
          <h2 className="text-base font-semibold">Live capacity</h2>
          {overview.onchain_state.status === 'unavailable' && (
            <p className="rounded-xl border border-orange-200 bg-[var(--warn-t)] px-3 py-2 text-sm">
              On-chain state unavailable: {overview.onchain_state.message} Signed terms remain visible. Spending is disabled until the deployment and network can be verified.
            </p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vault</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--good)]">{overview.onchain_state.status === 'available' ? overview.vault_available : 'Unavailable'}</dd>
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
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Payment entitlement feature</dt>
              <dd className="mt-1 fi-mono text-sm">research_fetch</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-semibold">Agents authorized by this permission</h3>
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
