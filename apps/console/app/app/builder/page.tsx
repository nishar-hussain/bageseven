'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EMBED_COMPONENTS, type EmbedComponentId } from '../../../lib/bagseven-sdk-react';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard, StatusPill } from '../../../components/app/ui';
import { billingApi, type Plan } from '../../../lib/billing-client';
import { useOperator } from '../../../lib/use-operator';
import { featureLabel, useFeatures } from '../../../lib/use-features';

type SavedComponent = {
  id: string;
  componentId: EmbedComponentId;
  name: string;
  heading: string;
  cta: string;
  ink: string;
  accent: string;
  soft: string;
  radius: string;
  powered: boolean;
  updatedAt: number;
  /** Seeded starter — editable & deletable */
  isDefault?: boolean;
};

const STORAGE_KEY = 'bagseven.builder.components.v2';
const LEGACY_STORAGE_KEY = 'bagseven.builder.components.v1';

const PRESETS = [
  { id: 'ink', label: 'Ink', ink: '#0f172a', accent: '#0f172a', soft: '#f8fafc' },
  { id: 'ocean', label: 'Ocean', ink: '#0c4a6e', accent: '#0284c7', soft: '#f0f9ff' },
  { id: 'forest', label: 'Forest', ink: '#14532d', accent: '#15803d', soft: '#f0fdf4' },
  { id: 'slate', label: 'Slate', ink: '#1e293b', accent: '#475569', soft: '#f1f5f9' },
  { id: 'rose', label: 'Rose', ink: '#9f1239', accent: '#e11d48', soft: '#fff1f2' },
] as const;

function defaultLibrary(): SavedComponent[] {
  const now = Date.now();
  return EMBED_COMPONENTS.map((c, i) => ({
    id: `default_${c.id}`,
    componentId: c.id,
    name: c.label,
    heading: c.id === 'cmp_pricing' ? 'Plans' : c.id === 'cmp_checkout' ? 'Checkout' : 'Your plan',
    cta: c.id === 'cmp_pricing' ? 'Choose plan' : c.id === 'cmp_checkout' ? 'Pay with wallet' : 'Manage',
    ink: '#0f172a',
    accent: '#0f172a',
    soft: '#f8fafc',
    radius: '16px',
    powered: true,
    updatedAt: now - i,
    isDefault: true,
  }));
}

function loadSaved(): SavedComponent[] {
  if (typeof window === 'undefined') return defaultLibrary();
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      const seeded = defaultLibrary();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as SavedComponent[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = defaultLibrary();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    // Migrate legacy / wiped defaults: keep customs, re-attach starter pack when none remain.
    const normalized = parsed.map((s) => ({
      ...s,
      isDefault: Boolean(s.isDefault || String(s.id || '').startsWith('default_')),
    }));
    const hasDefaults = normalized.some((s) => s.isDefault);
    const next = hasDefaults ? normalized : [...defaultLibrary(), ...normalized.filter((s) => !s.isDefault)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return defaultLibrary();
  }
}

function blankDraft(componentId: EmbedComponentId = 'cmp_pricing'): Omit<SavedComponent, 'id' | 'updatedAt' | 'isDefault'> {
  const base = EMBED_COMPONENTS.find((c) => c.id === componentId)!;
  return {
    componentId,
    name: `Custom ${base.label}`,
    heading: componentId === 'cmp_pricing' ? 'Plans' : componentId === 'cmp_checkout' ? 'Checkout' : 'Your plan',
    cta: 'Choose plan',
    ink: '#0f172a',
    accent: '#0f172a',
    soft: '#f8fafc',
    radius: '16px',
    powered: true,
  };
}

function draftEqualsSaved(
  draft: Omit<SavedComponent, 'id' | 'updatedAt' | 'isDefault'>,
  item: SavedComponent | undefined,
): boolean {
  if (!item) return false;
  return (
    item.componentId === draft.componentId &&
    item.name === draft.name &&
    item.heading === draft.heading &&
    item.cta === draft.cta &&
    item.ink === draft.ink &&
    item.accent === draft.accent &&
    item.soft === draft.soft &&
    item.radius === draft.radius &&
    item.powered === draft.powered
  );
}

/**
 * Schematic-style Builder: defaults you can edit/delete, create custom components, live preview.
 */
export default function BuilderPage() {
  const op = useOperator();
  const { features } = useFeatures();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [saved, setSaved] = useState<SavedComponent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(blankDraft());
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'react' | 'iframe' | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [creating, setCreating] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const pk = process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY || 'pk_test_…';

  useEffect(() => {
    const items = loadSaved();
    setSaved(items);
    const first = items[0];
    if (first) {
      setSelectedId(first.id);
      setDraft({
        componentId: first.componentId,
        name: first.name,
        heading: first.heading,
        cta: first.cta,
        ink: first.ink,
        accent: first.accent,
        soft: first.soft,
        radius: first.radius,
        powered: first.powered,
      });
      setCreating(false);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    void billingApi
      .listPlans()
      .then((r) => setPlans(r.plans.filter((p) => p.active)))
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, []);

  const persist = (next: SavedComponent[]) => {
    setSaved(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const selectedMeta = EMBED_COMPONENTS.find((c) => c.id === draft.componentId)!;
  const selectedSaved = saved.find((s) => s.id === selectedId);
  const dirty = hydrated && !draftEqualsSaved(draft, selectedSaved) && (selectedId !== null || creating);

  const openSaved = (item: SavedComponent) => {
    setCreating(false);
    setSelectedId(item.id);
    setDraft({
      componentId: item.componentId,
      name: item.name,
      heading: item.heading,
      cta: item.cta,
      ink: item.ink,
      accent: item.accent,
      soft: item.soft,
      radius: item.radius,
      powered: item.powered,
    });
    setMsg(item.isDefault ? `Editing default “${item.name}” — save to keep your changes` : `Editing “${item.name}”`);
  };

  const startCustom = (componentId: EmbedComponentId = 'cmp_pricing') => {
    setCreating(true);
    setSelectedId(null);
    setDraft(blankDraft(componentId));
    setMsg('New custom component — edit basics, then Save.');
  };

  const saveComponent = () => {
    const name = draft.name.trim() || selectedMeta.label;
    const now = Date.now();
    const nextDraft = { ...draft, name };
    if (selectedId) {
      const next = saved.map((s) =>
        s.id === selectedId
          ? {
              ...s,
              ...nextDraft,
              updatedAt: now,
              // After first edit of a default, keep id but drop “untouched starter” feel
              isDefault: s.isDefault,
            }
          : s,
      );
      persist(next);
      setDraft(nextDraft);
      setMsg(`Saved “${name}”`);
      return;
    }
    const id = `cmp_custom_${now.toString(36)}`;
    const item: SavedComponent = { id, ...nextDraft, updatedAt: now, isDefault: false };
    persist([item, ...saved]);
    setSelectedId(id);
    setCreating(false);
    setDraft(nextDraft);
    setMsg(`Created “${name}”`);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const victim = saved.find((s) => s.id === selectedId);
    const next = saved.filter((s) => s.id !== selectedId);
    persist(next);
    if (next[0]) {
      openSaved(next[0]);
    } else {
      setSelectedId(null);
      setCreating(true);
      setDraft(blankDraft());
    }
    setMsg(victim?.isDefault ? `Removed default “${victim.name}”` : 'Component removed');
  };

  const duplicateSelected = () => {
    const now = Date.now();
    const id = `cmp_custom_${now.toString(36)}`;
    const item: SavedComponent = {
      id,
      ...draft,
      name: `${draft.name.trim() || selectedMeta.label} copy`,
      updatedAt: now,
      isDefault: false,
    };
    persist([item, ...saved]);
    setCreating(false);
    setSelectedId(id);
    setDraft({
      componentId: item.componentId,
      name: item.name,
      heading: item.heading,
      cta: item.cta,
      ink: item.ink,
      accent: item.accent,
      soft: item.soft,
      radius: item.radius,
      powered: item.powered,
    });
    setMsg(`Duplicated as “${item.name}”`);
  };

  const restoreDefaults = () => {
    const defaults = defaultLibrary();
    const customs = saved.filter((s) => !s.isDefault && !s.id.startsWith('default_'));
    const next = [...defaults, ...customs];
    persist(next);
    openSaved(defaults[0]!);
    setMsg('Restored starter components (your custom ones were kept)');
  };

  const issueToken = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/embed-token', { method: 'POST' });
      const json = (await res.json()) as { token?: string; error?: { message?: string } };
      if (!res.ok || !json.token) throw new Error(json.error?.message ?? `token ${res.status}`);
      setToken(json.token);
      setMsg('Customer access token ready — subscribe / portal actions work in the preview.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const themeQuery = useMemo(() => {
    const q = new URLSearchParams({
      component: draft.componentId,
      ink: draft.ink,
      accent: draft.accent,
      soft: draft.soft,
      radius: draft.radius,
      heading: draft.heading,
      cta: draft.cta,
    });
    if (!draft.powered) q.set('powered', '0');
    if (token) q.set('token', token);
    if (pk) q.set('pk', pk);
    if (op.holder) q.set('holder', op.holder);
    return q;
  }, [draft, token, pk, op.holder]);

  const iframeSrc = `${origin}/embed?${themeQuery.toString()}`;

  const reactSnippet = `import { BagsevenProvider, BagsevenEmbed } from "@bagseven/sdk/react";

<BagsevenProvider publishableKey="${pk}">
  <BagsevenEmbed
    component="${draft.componentId}"
    accessToken={accessToken}
    holder={customerId}
    apiUrl="/api/public"
    heading="${draft.heading.replace(/"/g, '\\"')}"
    ctaLabel="${draft.cta.replace(/"/g, '\\"')}"
    showPoweredBy={${draft.powered}}
    theme={{
      ink: "${draft.ink}",
      accent: "${draft.accent}",
      soft: "${draft.soft}",
      radius: "${draft.radius}",
    }}
  />
</BagsevenProvider>`;

  const iframeSnippet = `<iframe
  src="${iframeSrc}"
  style="border:0;width:100%;min-height:560px;border-radius:${draft.radius}"
  title="Bagseven ${draft.name}"
></iframe>`;

  const copy = async (kind: 'react' | 'iframe') => {
    const text = kind === 'react' ? reactSnippet : iframeSnippet;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };

  const payConfigured = Boolean(op.status?.tracks.whitechain.pay_to && op.status?.tracks.whitechain.usdt);
  const payToShort = op.status?.tracks.whitechain.pay_to
    ? `${op.status.tracks.whitechain.pay_to.slice(0, 8)}…`
    : null;
  const defaults = saved.filter((s) => s.isDefault);
  const customs = saved.filter((s) => !s.isDefault);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Builder"
        description="Starter embeds you can edit or delete — plus create your own. Preview live, then drop into your product."
        action={
          <>
            <SecondaryButton href="/app/developers">API keys</SecondaryButton>
            <SecondaryButton href="/app/plans">Plans</SecondaryButton>
            <PrimaryButton onClick={() => startCustom('cmp_pricing')}>New component</PrimaryButton>
          </>
        }
      />

      {!op.loading && !payConfigured ? (
        <SoftCard className="border-[var(--warn)]/40 bg-[var(--warn-soft,#fffbeb)] p-4 text-[13px]">
          <strong>Whitechain recipient missing.</strong> Mint / buy credits need{' '}
          <code className="fi-mono text-xs">WHITECHAIN_PAY_TO</code>. Check{' '}
          <Link href="/app/settings" className="font-semibold text-[var(--blue)]">
            Tracks
          </Link>
          .
        </SoftCard>
      ) : null}

      {!op.loading && payConfigured ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--muted)]">
          <StatusPill tone="good">Whitechain ready</StatusPill>
          <span>
            Recipient {payToShort}
            {op.status?.tracks.whitechain.operator ? ' · operator settle on' : ''}
            {op.status?.tracks.whitechain.demo_settle ? ' · demo settle' : ' · live verify'}
          </span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Library */}
        <SoftCard className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Library</div>
            <span className="fi-mono text-[10px] text-[var(--muted)]">{saved.length}</span>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Defaults</div>
              {defaults.length < EMBED_COMPONENTS.length ? (
                <button
                  type="button"
                  onClick={restoreDefaults}
                  className="text-[11px] font-semibold text-[var(--blue)] hover:underline"
                >
                  Restore starters
                </button>
              ) : null}
            </div>
            {defaults.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--line)] px-3 py-3 text-[12px] text-[var(--muted)]">
                All starters deleted.{' '}
                <button type="button" className="font-semibold text-[var(--blue)]" onClick={restoreDefaults}>
                  Restore
                </button>
              </p>
            ) : (
              <ul className="space-y-1.5">
                {defaults.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openSaved(s)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                        selectedId === s.id && !creating
                          ? 'border-[var(--ink)] bg-[var(--soft)] shadow-[0_0_0_1px_var(--ink)]'
                          : 'border-[var(--line)] hover:border-[var(--ink)]/30'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-black/5"
                          style={{ background: `linear-gradient(135deg, ${s.soft} 0%, ${s.accent} 100%)` }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold">{s.name}</span>
                            <span className="rounded-full bg-[var(--soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                              Default
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{s.componentId}</span>
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-[var(--line)] pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Your custom</div>
              <button
                type="button"
                onClick={() => startCustom('cmp_pricing')}
                className="text-[11px] font-semibold text-[var(--blue)] hover:underline"
              >
                + Create
              </button>
            </div>
            {customs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--soft)]/40 px-3 py-3 text-[12px] text-[var(--muted)]">
                No custom components yet. Duplicate a default or create from scratch.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {customs.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openSaved(s)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                        selectedId === s.id && !creating
                          ? 'border-[var(--ink)] bg-[var(--soft)] shadow-[0_0_0_1px_var(--ink)]'
                          : 'border-[var(--line)] hover:border-[var(--ink)]/30'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-black/5"
                          style={{ background: `linear-gradient(135deg, ${s.soft} 0%, ${s.accent} 100%)` }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{s.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                            {EMBED_COMPONENTS.find((c) => c.id === s.componentId)?.label ?? s.componentId}
                          </span>
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-[var(--line)] pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Create from type
            </div>
            <div className="grid gap-1.5">
              {EMBED_COMPONENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => startCustom(c.id)}
                  className={`rounded-xl border border-dashed px-3 py-2 text-left text-[12px] hover:border-[var(--ink)]/40 hover:bg-[var(--soft)]/50 ${
                    creating && draft.componentId === c.id && !selectedId
                      ? 'border-[var(--ink)] bg-[var(--soft)]'
                      : 'border-[var(--line)]'
                  }`}
                >
                  <span className="font-semibold">{c.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">{c.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        </SoftCard>

        {/* Editor */}
        <SoftCard className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="neutral">Edit</StatusPill>
                {dirty ? <StatusPill tone="warn">Unsaved</StatusPill> : null}
                {creating ? (
                  <StatusPill tone="neutral">New draft</StatusPill>
                ) : selectedSaved?.isDefault ? (
                  <StatusPill tone="neutral">Default</StatusPill>
                ) : selectedId ? (
                  <StatusPill tone="good">Custom</StatusPill>
                ) : null}
              </div>
              <h2 className="mt-2 text-[16px] font-semibold">{draft.name || selectedMeta.label}</h2>
              <p className="mt-1 text-[12px] text-[var(--muted)]">{selectedMeta.blurb}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedId ? (
                <>
                  <SecondaryButton onClick={duplicateSelected}>Duplicate</SecondaryButton>
                  <SecondaryButton onClick={deleteSelected}>Delete</SecondaryButton>
                </>
              ) : null}
              <PrimaryButton onClick={saveComponent}>{selectedId ? 'Save changes' : 'Save component'}</PrimaryButton>
            </div>
          </div>

          <div className="grid gap-3">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Display name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Pricing — marketing site"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Component type</span>
              <select
                value={draft.componentId}
                onChange={(e) => {
                  const componentId = e.target.value as EmbedComponentId;
                  setDraft((d) => ({
                    ...d,
                    componentId,
                    heading:
                      d.heading === blankDraft(d.componentId).heading
                        ? blankDraft(componentId).heading
                        : d.heading,
                  }));
                }}
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              >
                {EMBED_COMPONENTS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.id})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--soft)]/40 p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Copy</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Heading</span>
                <input
                  value={draft.heading}
                  onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">CTA label</span>
                <input
                  value={draft.cta}
                  onChange={(e) => setDraft((d) => ({ ...d, cta: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--soft)]/40 p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Look</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, ink: p.ink, accent: p.accent, soft: p.soft }))}
                  className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold hover:border-[var(--ink)]/40"
                  style={{ background: p.soft, color: p.ink }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['Ink', 'ink'],
                  ['Accent', 'accent'],
                  ['Soft bg', 'soft'],
                ] as const
              ).map(([label, key]) => (
                <label key={key} className="block space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</span>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--line)] bg-white p-1"
                    />
                    <input
                      value={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      className="fi-mono w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs"
                    />
                  </div>
                </label>
              ))}
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Radius</span>
                <select
                  value={draft.radius}
                  onChange={(e) => setDraft((d) => ({ ...d, radius: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                >
                  <option value="8px">8px — tight</option>
                  <option value="12px">12px</option>
                  <option value="16px">16px — default</option>
                  <option value="20px">20px — soft</option>
                  <option value="24px">24px — round</option>
                </select>
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={draft.powered}
                onChange={(e) => setDraft((d) => ({ ...d, powered: e.target.checked }))}
                className="rounded border-[var(--line)]"
              />
              Show “Powered by Bagseven”
            </label>
          </div>

          {msg ? <p className="text-[13px] text-[var(--muted)]">{msg}</p> : null}

          <div className="border-t border-[var(--line)] pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Drop-in code</div>
              <div className="flex gap-2">
                <SecondaryButton onClick={() => void copy('react')}>
                  {copied === 'react' ? 'Copied' : 'Copy React'}
                </SecondaryButton>
                <SecondaryButton onClick={() => void copy('iframe')}>
                  {copied === 'iframe' ? 'Copied' : 'Copy iframe'}
                </SecondaryButton>
              </div>
            </div>
            <pre className="max-h-40 overflow-auto rounded-xl bg-[var(--hero)] p-3 font-mono text-[10px] leading-relaxed text-white/90">
              {reactSnippet}
            </pre>
          </div>
        </SoftCard>

        {/* Preview */}
        <SoftCard className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Live preview</div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {plans.length} active plan{plans.length === 1 ? '' : 's'} · {selectedMeta.id}
                {dirty ? ' · unsaved edits shown' : ''}
              </p>
            </div>
            <PrimaryButton disabled={busy || !op.holder} onClick={() => void issueToken()}>
              {busy ? 'Issuing…' : token ? 'Refresh token' : 'Customer token'}
            </PrimaryButton>
          </div>

          {plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--soft)]/50 px-4 py-8 text-center text-[13px] text-[var(--muted)]">
              No plans yet —{' '}
              <Link href="/app/plans" className="font-semibold text-[var(--blue)]">
                create one
              </Link>{' '}
              so pricing preview has content.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
              <table className="w-full min-w-[280px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--soft)]/60 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Entitles</th>
                    <th className="px-3 py-2">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.slice(0, 4).map((p) => {
                    const ft = features.find((f) => f.id === p.feature);
                    return (
                      <tr key={p.id} className="border-b border-[var(--line)] last:border-0">
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">
                          {featureLabel(p.feature, features)}
                          {ft?.value_type === 'boolean' ? '' : ` · ${p.credits}`}
                        </td>
                        <td className="px-3 py-2">
                          {p.amount} / {p.interval === 'month' ? 'mo' : 'once'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div
            className="overflow-hidden rounded-2xl border border-[var(--line)]"
            style={{ background: draft.soft, borderRadius: draft.radius }}
          >
            <iframe
              key={iframeSrc}
              title={`preview-${draft.componentId}`}
              src={iframeSrc}
              className="h-[520px] w-full bg-transparent"
            />
          </div>
          <a href={iframeSrc} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[var(--blue)]">
            Open preview full page →
          </a>
        </SoftCard>
      </div>
    </div>
  );
}
