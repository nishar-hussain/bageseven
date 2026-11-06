'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { entitlementsApi, type Grant } from '../../lib/entitlements-client';
import { featureLabel, shortId } from '../../lib/use-operator';
import { useFeatures } from '../../lib/use-features';

function useTtl(paidThrough: string) {
  const [label, setLabel] = useState('…');
  const [dead, setDead] = useState(false);
  useEffect(() => {
    const tick = () => {
      const ms = new Date(paidThrough).getTime() - Date.now();
      if (ms <= 0) {
        setLabel('evaporated');
        setDead(true);
        return;
      }
      setDead(false);
      const s = Math.ceil(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) setLabel(`${h}h ${m % 60}m`);
      else setLabel(m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [paidThrough]);
  return { label, dead };
}

function GrantRow({
  grant,
  network,
  selected,
  onSelect,
  onPaidRun,
  onCancel,
  busy,
  valueType,
}: {
  grant: Grant;
  network: string;
  selected: boolean;
  onSelect: () => void;
  onPaidRun: () => void;
  onCancel: () => void;
  busy: boolean;
  valueType: 'boolean' | 'numeric';
}) {
  const { label, dead } = useTtl(grant.paid_through);
  const host = network === 'mainnet' ? 'https://explorer.whitechain.io' : 'https://explorer.testnet.whitechain.io';
  const explorer = grant.payment_tx ? `${host}/tx/${grant.payment_tx}` : null;
  const isBoolean = valueType === 'boolean';
  return (
    <div
      className={`border-t border-[var(--line)] py-4 first:border-t-0 first:pt-0 ${selected ? 'bg-[var(--tint)]/40 -mx-2 px-2 rounded-xl' : ''}`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-medium">
              {featureLabel(grant.feature)} entitlement
              <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {isBoolean ? 'boolean · Arkiv' : 'numeric · Arkiv'}
              </span>
            </div>
            <div className="text-xs text-[var(--muted)]">
              {grant.holder}
              <span className="fi-mono ml-2 opacity-60" title={grant.id}>
                {shortId(grant.id)}
              </span>
            </div>
          </div>
          <div className={`text-2xl tracking-tight ${dead ? 'text-[var(--deny)]' : 'text-[var(--good)]'}`}>{label}</div>
        </div>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
        <span>
          {isBoolean ? (
            <>
              <strong className="text-[var(--ink)]">{dead ? 'Off' : 'On'}</strong> until TTL
            </>
          ) : (
            <>
              <strong className="text-[var(--ink)]">{grant.remaining}</strong> credits left
            </>
          )}
        </span>
        <span>Renewal {grant.renewal_enabled ? 'on' : 'off'}</span>
        {explorer && (
          <a className="font-medium text-[var(--blue)] underline" href={explorer} target="_blank" rel="noreferrer">
            Whitechain
          </a>
        )}
        {!isBoolean ? (
          <button
            type="button"
            disabled={busy || dead}
            onClick={() => onPaidRun()}
            className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            Spend 1 credit
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !grant.renewal_enabled}
          onClick={() => onCancel()}
          className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
        >
          Cancel renewal
        </button>
      </div>
    </div>
  );
}

export function GrantList({
  feature,
  holder,
  selectable = false,
  onSelect,
  selectedId,
}: {
  feature?: string;
  holder?: string;
  selectable?: boolean;
  onSelect?: (grant: Grant) => void;
  selectedId?: string;
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [network, setNetwork] = useState('testnet');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [localSelected, setLocalSelected] = useState<string | undefined>(selectedId);
  const { features } = useFeatures();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const live = await entitlementsApi.live({ feature, holder });
      const list = live.grants ?? [];
      setGrants(list);
      setLocalSelected((prev) => {
        if (prev && list.some((g) => g.id === prev)) return prev;
        return list[0]?.id;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [feature, holder]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId) setLocalSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectable || !localSelected) return;
    const g = grants.find((x) => x.id === localSelected);
    if (g) onSelect?.(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSelected, grants, selectable]);

  useEffect(() => {
    void entitlementsApi
      .status()
      .then((s) => {
        if (s?.tracks.whitechain.network) setNetwork(s.tracks.whitechain.network);
      })
      .catch(() => undefined);
  }, []);

  const paidRun = async (grant: Grant) => {
    setBusyId(grant.id);
    setActionMsg('Running…');
    try {
      const r = await entitlementsApi.paidRun({
        grant_id: grant.id,
        amount: '1',
        work: 'console run',
      });
      setActionMsg(`Spent 1 credit · ${r.grant.remaining} left`);
      await refresh();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (grant: Grant) => {
    setBusyId(grant.id);
    setActionMsg('Cancelling renewal…');
    try {
      const r = await entitlementsApi.cancelRenewal(grant.id);
      setActionMsg(`Renewal ${r.grant.renewal_enabled ? 'on' : 'off'}`);
      await refresh();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Living entitlements</h2>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--soft)]"
        >
          Refresh
        </button>
      </div>
      {loading && grants.length === 0 && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {error && <p className="text-sm text-[var(--deny)]">{error}</p>}
      {!loading && !error && grants.length === 0 && (
        <div className="py-10 text-center">
          <p className="font-medium text-[var(--ink)]">No entitlements yet</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Create living Arkiv access — boolean on/off or numeric credits, both with TTL.
          </p>
          <Link href="/app/mint" className="mt-5 inline-flex rounded-full bg-[var(--ink)] px-5 py-2 text-sm font-semibold text-white">
            Create entitlement
          </Link>
        </div>
      )}
      {grants.map((g) => (
        <GrantRow
          key={g.id}
          grant={g}
          network={network}
          valueType={features.find((f) => f.id === g.feature)?.value_type ?? 'numeric'}
          selected={selectable && localSelected === g.id}
          busy={busyId === g.id}
          onSelect={() => {
            setLocalSelected(g.id);
            onSelect?.(g);
          }}
          onPaidRun={() => void paidRun(g)}
          onCancel={() => void cancel(g)}
        />
      ))}
      {actionMsg && <p className="mt-3 text-sm text-[var(--muted)]">{actionMsg}</p>}
    </div>
  );
}
