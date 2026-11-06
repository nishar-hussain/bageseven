'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard } from '../../../components/app/ui';
import { billingApi, type Plan } from '../../../lib/billing-client';
import { useOperator } from '../../../lib/use-operator';

type BlockType = 'hero' | 'plan' | 'pay' | 'portal' | 'gate' | 'spacer';

type Block = {
  id: string;
  type: BlockType;
  title?: string;
  body?: string;
  feature?: string;
};

const PALETTE: Array<{ type: BlockType; label: string; hint: string }> = [
  { type: 'hero', label: 'Hero', hint: 'Headline + pitch' },
  { type: 'plan', label: 'Plan', hint: 'Price + credits' },
  { type: 'pay', label: 'Checkout', hint: 'Pay CTA' },
  { type: 'portal', label: 'Portal', hint: 'Living access' },
  { type: 'gate', label: 'Gate', hint: 'Entitled-only UI' },
  { type: 'spacer', label: 'Spacer', hint: 'Vertical space' },
];

function uid() {
  return `b_${Math.random().toString(36).slice(2, 9)}`;
}

export default function BuilderPage() {
  const op = useOperator();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([
    { id: uid(), type: 'hero', title: 'Unlock access', body: 'Pay once. Access stays live until TTL.' },
    { id: uid(), type: 'plan' },
    { id: uid(), type: 'pay' },
    { id: uid(), type: 'portal' },
  ]);
  const [dragType, setDragType] = useState<BlockType | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewSession, setPreviewSession] = useState('');

  useEffect(() => {
    void billingApi
      .listPlans()
      .then((r) => {
        setPlans(r.plans);
        if (r.plans[0]) setPlanId(r.plans[0].id);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, []);

  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const selectedBlock = blocks.find((b) => b.id === selected) ?? null;

  const mintPreviewSession = async () => {
    if (!plan) {
      setMsg('Create a plan under Plans first.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const r = await billingApi.createCheckout({
        plan_id: plan.id,
        holder: op.holder || undefined,
      });
      setPreviewSession(r.session.id);
      setMsg('Preview session ready.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const moveBlock = useCallback((from: number, to: number) => {
    setBlocks((prev) => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (!item) return prev;
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const addBlock = (type: BlockType, at?: number) => {
    const block: Block = {
      id: uid(),
      type,
      title: type === 'hero' ? 'Your product' : type === 'gate' ? 'Entitled content' : undefined,
      body:
        type === 'hero'
          ? 'Stablecoin checkout that mints a living entitlement.'
          : type === 'gate'
            ? 'Only visible when the feature is live.'
            : undefined,
      feature: type === 'gate' ? plan?.feature ?? 'ocr' : undefined,
    };
    setBlocks((prev) => {
      const next = [...prev];
      const idx = at === undefined ? next.length : at;
      next.splice(idx, 0, block);
      return next;
    });
    setSelected(block.id);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selected === id) setSelected(null);
  };

  const updateSelected = (patch: Partial<Block>) => {
    if (!selected) return;
    setBlocks((prev) => prev.map((b) => (b.id === selected ? { ...b, ...patch } : b)));
  };

  const snippet = useMemo(() => {
    const views = blocks
      .map((b) => b.type)
      .filter((t, i, a) => a.indexOf(t) === i && (t === 'portal' || t === 'pay' || t === 'gate'));
    const initial = views.includes('pay') ? 'checkout' : 'portal';
    return `import { BagsevenProvider, FeatureFlagGuard, BagsevenEmbed } from "@bagseven/sdk/react";

<BagsevenProvider publishableKey={process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY!}>
  ${
    blocks.some((b) => b.type === 'gate')
      ? `<FeatureFlagGuard feature="${plan?.feature ?? 'ocr'}">
    <YourFeatureUI />
  </FeatureFlagGuard>`
      : ''
  }
  <BagsevenEmbed
    accessToken={token}
    checkoutSessionId={sessionId}
    initialView="${initial}"
  />
</BagsevenProvider>`;
  }, [blocks, plan?.feature]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Builder"
        description="Embed checkout + entitlement portal."
        action={
          <>
            <SecondaryButton href="/app/plans">Plans</SecondaryButton>
            <PrimaryButton disabled={busy || !plan} onClick={() => void mintPreviewSession()}>
              {busy ? 'Minting…' : 'Preview'}
            </PrimaryButton>
          </>
        }
      />

      {msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}

      <SoftCard className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs font-semibold uppercase text-[var(--muted)]">
          Bound plan
          <select
            className="mt-1 block min-w-[220px] rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            {plans.length === 0 ? <option value="">Create a plan first</option> : null}
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.amount} USDT
              </option>
            ))}
          </select>
        </label>
        {previewSession ? (
          <a
            href={`/checkout?session=${encodeURIComponent(previewSession)}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-[var(--blue)]"
          >
            Open preview →
          </a>
        ) : null}
      </SoftCard>

      <div className="grid gap-4 lg:grid-cols-[180px_1fr_260px]">
        <aside className="rounded-2xl border border-[var(--line)] bg-white p-3 shadow-[var(--sh)]">
          <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">Blocks</div>
          <div className="space-y-1.5">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                draggable
                onDragStart={() => setDragType(p.type)}
                onDragEnd={() => setDragType(null)}
                onClick={() => addBlock(p.type)}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--soft)] px-3 py-2 text-left hover:border-[var(--ink)]/30"
              >
                <div className="text-[13px] font-semibold">{p.label}</div>
                <div className="text-[11px] text-[var(--muted)]">{p.hint}</div>
              </button>
            ))}
          </div>
        </aside>

        <div
          className="min-h-[520px] rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragType) addBlock(dragType);
            setDragType(null);
            setDragIndex(null);
          }}
        >
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">Canvas</div>
          <div className="mx-auto max-w-md space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--soft)]/40 p-4">
            {blocks.length === 0 ? (
              <p className="py-12 text-center text-sm text-[var(--muted)]">Add blocks from the left.</p>
            ) : null}
            {blocks.map((b, index) => (
              <div
                key={b.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) moveBlock(dragIndex, index);
                  else if (dragType) addBlock(dragType, index);
                  setDragIndex(null);
                  setDragType(null);
                }}
                onClick={() => setSelected(b.id)}
                className={`cursor-grab rounded-xl border bg-white px-3 py-3 ${
                  selected === b.id ? 'border-[var(--ink)] ring-2 ring-[var(--ink)]/10' : 'border-[var(--line)]'
                }`}
              >
                {b.type === 'hero' && (
                  <div>
                    <div className="text-lg font-semibold tracking-tight">{b.title || 'Hero'}</div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{b.body}</p>
                  </div>
                )}
                {b.type === 'plan' && (
                  <div className="rounded-xl bg-[var(--soft)] p-3">
                    <div className="text-sm font-semibold">{plan?.name ?? 'Select a plan'}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                      {plan ? `${plan.amount} USDT · ${plan.credits} credits · ${plan.feature}` : 'No plan bound'}
                    </div>
                  </div>
                )}
                {b.type === 'pay' && (
                  <button type="button" className="w-full rounded-full bg-[var(--ink)] py-2.5 text-sm font-semibold text-white">
                    Pay with wallet
                  </button>
                )}
                {b.type === 'portal' && (
                  <div className="text-sm">
                    <div className="font-semibold">Living entitlements</div>
                    <p className="mt-1 text-[var(--muted)]">
                      {op.holder ? `Portal for ${op.holder}` : 'Remaining credits + TTL'}
                    </p>
                  </div>
                )}
                {b.type === 'gate' && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      Gate · {b.feature || 'ocr'}
                    </div>
                    <div className="mt-1 font-medium">{b.title || 'Gated UI'}</div>
                    <p className="text-[var(--muted)]">{b.body}</p>
                  </div>
                )}
                {b.type === 'spacer' && <div className="h-6" />}
                <div className="mt-2 flex justify-end">
                  <button type="button" className="text-[11px] text-[var(--deny)]" onClick={() => removeBlock(b.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">Inspector</div>
          {!selectedBlock ? <p className="text-sm text-[var(--muted)]">Select a block.</p> : null}
          {selectedBlock && (selectedBlock.type === 'hero' || selectedBlock.type === 'gate') ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
                Title
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  value={selectedBlock.title ?? ''}
                  onChange={(e) => updateSelected({ title: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
                Body
                <textarea
                  className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  rows={3}
                  value={selectedBlock.body ?? ''}
                  onChange={(e) => updateSelected({ body: e.target.value })}
                />
              </label>
              {selectedBlock.type === 'gate' ? (
                <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
                  Feature
                  <input
                    className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                    value={selectedBlock.feature ?? 'ocr'}
                    onChange={(e) => updateSelected({ feature: e.target.value })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          {selectedBlock && selectedBlock.type !== 'hero' && selectedBlock.type !== 'gate' ? (
            <p className="text-sm text-[var(--muted)]">Driven by the bound plan — nothing to edit.</p>
          ) : null}

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">Snippet</div>
            <pre className="mt-2 max-h-52 overflow-auto rounded-xl bg-[var(--hero)] p-3 font-mono text-[10px] leading-relaxed text-white/90">
              {snippet}
            </pre>
          </div>
          <p className="text-[12px] text-[var(--muted)]">
            Need a plan first?{' '}
            <Link href="/app/plans" className="font-semibold text-[var(--blue)]">
              Create one
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
