'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, PrimaryButton, SoftCard, StatusPill, EmptyState } from '../../../components/app/ui';
import { entitlementsApi } from '../../../lib/entitlements-client';
import { useFeatures } from '../../../lib/use-features';

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 64);
}

export default function FeaturesPage() {
  const { features, loading, refresh } = useFeatures();
  const [showCreate, setShowCreate] = useState(false);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [blurb, setBlurb] = useState('');
  const [valueType, setValueType] = useState<'boolean' | 'numeric'>('numeric');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const featureId = slugify(id || label);
      if (!featureId) throw new Error('Enter a feature id or name');
      const r = await entitlementsApi.createFeature({
        id: featureId,
        label: label.trim() || featureId,
        blurb: blurb.trim() || undefined,
        value_type: valueType,
      });
      setMsg(`Created ${r.feature.id} (${r.feature.value_type})`);
      setShowCreate(false);
      setId('');
      setLabel('');
      setBlurb('');
      setValueType('numeric');
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Features"
        description="Gate anything — boolean on/off or numeric credits. Living grants are Registry-powered until paid_through."
        action={
          <PrimaryButton onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Close' : 'New feature'}</PrimaryButton>
        }
      />

      {showCreate ? (
        <SoftCard className="p-5">
          <h2 className="text-[15px] font-semibold">New feature</h2>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Id is a stable slug used in SDK / MCP checks (e.g. <code className="fi-mono text-xs">api_access</code>). Pick boolean
            (flag) or numeric (metered credits) — both write living Registry entitlements.
          </p>
          <form onSubmit={(e) => void create(e)} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Name
              <input
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (!id) setId(slugify(e.target.value));
                }}
                placeholder="API access"
                required
              />
            </label>
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Id (slug)
              <input
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-sm"
                value={id}
                onChange={(e) => setId(slugify(e.target.value))}
                placeholder="api_access"
                pattern="[a-z][a-z0-9_]{1,63}"
                required
              />
            </label>
            <label className="block text-xs font-semibold uppercase text-[var(--muted)] md:col-span-2">
              Description
              <input
                className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={blurb}
                onChange={(e) => setBlurb(e.target.value)}
                placeholder="Optional — shown in the console"
              />
            </label>
            <fieldset className="md:col-span-2">
              <legend className="text-xs font-semibold uppercase text-[var(--muted)]">Value type</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setValueType('boolean')}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    valueType === 'boolean' ? 'border-[var(--blue)] bg-[var(--blue)] text-white' : 'border-[var(--line)]'
                  }`}
                >
                  Boolean — on / off until TTL
                </button>
                <button
                  type="button"
                  onClick={() => setValueType('numeric')}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    valueType === 'numeric' ? 'border-[var(--blue)] bg-[var(--blue)] text-white' : 'border-[var(--line)]'
                  }`}
                >
                  Numeric — metered credits
                </button>
              </div>
            </fieldset>
            <div className="md:col-span-2">
              <PrimaryButton type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create feature'}
              </PrimaryButton>
            </div>
          </form>
        </SoftCard>
      ) : null}

      {msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}

      <SoftCard>
        {loading && features.length === 0 ? (
          <p className="p-6 text-sm text-[var(--muted)]">Loading…</p>
        ) : features.length === 0 ? (
          <EmptyState
            title="No features yet"
            body="Create a feature SKU, then mint entitlements or attach plans."
            action={<PrimaryButton onClick={() => setShowCreate(true)}>New feature</PrimaryButton>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3">Feature</th>
                  <th className="px-4 py-3">Id</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--soft)]/60">
                    <td className="px-4 py-3.5">
                      <div className="font-medium">{f.label}</div>
                      <div className="text-[12px] text-[var(--muted)]">{f.blurb}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-[var(--muted)]">{f.id}</td>
                    <td className="px-4 py-3.5">
                      <StatusPill tone={f.value_type === 'boolean' ? 'good' : 'neutral'}>
                        {f.value_type === 'boolean' ? 'Boolean' : 'Numeric'}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusPill tone={f.builtin ? 'neutral' : 'good'}>{f.builtin ? 'Built-in' : 'Custom'}</StatusPill>
                    </td>
                    <td className="px-4 py-3.5 text-[var(--muted)]">{f.actions.join(', ')}</td>
                    <td className="px-4 py-3.5 text-right">
                      <Link href={`/app/mint?feature=${encodeURIComponent(f.id)}`} className="text-[13px] font-semibold text-[var(--blue)]">
                        Entitle →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SoftCard>
    </div>
  );
}
