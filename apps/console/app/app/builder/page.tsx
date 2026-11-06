'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
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
  { type: 'hero', label: 'Hero', hint: 'Headline + short pitch' },
  { type: 'plan', label: 'Plan card', hint: 'Price + credits from a Plan' },
  { type: 'pay', label: 'Pay / checkout', hint: 'WhiteWallet pay CTA' },
  { type: 'portal', label: 'Entitlement portal', hint: 'Living grants remaining + TTL' },
  { type: 'gate', label: 'Feature gate', hint: 'Show content only if entitled' },
  { type: 'spacer', label: 'Spacer', hint: 'Vertical breathing room' },
];

function uid() {
  return `b_${Math.random().toString(36).slice(2, 9)}`;
}

export default function BuilderPage() {
  const op = useOperator();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([
    { id: uid(), type: 'hero', title: 'Unlock OCR', body: 'Pay once on Whitechain. Access lives on Arkiv until TTL.' },
    { id: uid(), type: 'plan' },
    { id: uid(), type: 'pay' },
    { id: uid(), type: 'portal' },
  ]);
  const [dragType, setDragType] = useState<BlockType | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

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
      body: type === 'hero' ? 'Stablecoin checkout that mints a living entitlement.' : type === 'gate' ? 'Only visible when the feature is live.' : undefined,
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
  ${blocks.some((b) => b.type === 'gate')
    ? `<FeatureFlagGuard feature="${plan?.feature ?? 'ocr'}">
    <YourFeatureUI />
  </FeatureFlagGuard>`
    : ''}
  <BagsevenEmbed
    accessToken={token}
    checkoutSessionId={sessionId}
    initialView="${initial}"
  />
</BagsevenProvider>`;
  }, [blocks, plan?.feature]);

  const iframe = `<iframe src="${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/checkout?session=cs_…" style="border:0;width:100%;min-height:520px"></iframe>`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Embed builder</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Drag blocks into a checkout / entitlement page. Preview updates live. Drop into your SaaS via snippet or iframe — not a separate site builder.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {msg && <p className="text-sm text-[var(--deny)]">{msg}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]">
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
        <Link href="/app/plans" className="text-sm font-semibold text-[var(--blue)] underline">
          Manage plans
        </Link>
        <Link href="/app/checkouts" className="text-sm font-semibold text-[var(--blue)] underline">
          Open checkout session
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr_280px]">
        {/* Palette */}
        <aside className="rounded-2xl border border-[var(--line)] bg-white p-3 shadow-[var(--sh)]">
          <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Blocks</div>
          <div className="space-y-2">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                draggable
                onDragStart={() => setDragType(p.type)}
                onDragEnd={() => setDragType(null)}
                onClick={() => addBlock(p.type)}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--soft)] px-3 py-2 text-left hover:border-[var(--blue)]"
              >
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-[11px] text-[var(--muted)]">{p.hint}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div
          className="min-h-[520px] rounded-2xl border border-dashed border-[var(--line)] bg-[#fafafa] p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragType) addBlock(dragType);
            setDragType(null);
            setDragIndex(null);
          }}
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Canvas · drop here</div>
          <div className="mx-auto max-w-md space-y-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]">
            {blocks.length === 0 && (
              <p className="py-12 text-center text-sm text-[var(--muted)]">Drag blocks from the left to compose the page.</p>
            )}
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
                className={`cursor-grab rounded-xl border px-3 py-3 ${
                  selected === b.id ? 'border-[var(--blue)] ring-2 ring-[var(--blue)]/20' : 'border-[var(--line)]'
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
                    <div className="mt-1 fi-mono text-xs text-[var(--muted)]">
                      {plan ? `${plan.amount} USDT · ${plan.credits} credits · ${plan.feature}` : 'No plan bound'}
                    </div>
                  </div>
                )}
                {b.type === 'pay' && (
                  <button type="button" className="w-full rounded-full bg-[var(--blue)] py-2.5 text-sm font-semibold text-white">
                    Pay with WhiteWallet / EVM
                  </button>
                )}
                {b.type === 'portal' && (
                  <div className="text-sm">
                    <div className="font-semibold">Living entitlements</div>
                    <p className="mt-1 text-[var(--muted)]">
                      {op.holder ? `Portal for ${op.holder}` : 'Holder portal (remaining + TTL)'}
                    </p>
                  </div>
                )}
                {b.type === 'gate' && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm">
                    <div className="text-xs font-semibold uppercase text-[var(--muted)]">FeatureFlagGuard · {b.feature || 'ocr'}</div>
                    <div className="mt-1 font-medium">{b.title || 'Gated UI'}</div>
                    <p className="text-[var(--muted)]">{b.body}</p>
                  </div>
                )}
                {b.type === 'spacer' && <div className="h-6" />}
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" className="text-[11px] text-[var(--deny)]" onClick={() => removeBlock(b.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Inspector */}
        <aside className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[var(--sh)]">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Inspector</div>
          {!selectedBlock && <p className="text-sm text-[var(--muted)]">Select a block on the canvas.</p>}
          {selectedBlock && (selectedBlock.type === 'hero' || selectedBlock.type === 'gate') && (
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
              {selectedBlock.type === 'gate' && (
                <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
                  Feature
                  <input
                    className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                    value={selectedBlock.feature ?? 'ocr'}
                    onChange={(e) => updateSelected({ feature: e.target.value })}
                  />
                </label>
              )}
            </div>
          )}
          {selectedBlock && selectedBlock.type !== 'hero' && selectedBlock.type !== 'gate' && (
            <p className="text-sm text-[var(--muted)]">This block is driven by Plan / session data — no copy to edit.</p>
          )}

          <div>
            <div className="text-xs font-semibold uppercase text-[var(--muted)]">Drop-in snippet</div>
            <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-[var(--hero)] p-3 font-mono text-[10px] text-white/90">{snippet}</pre>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-[var(--muted)]">Iframe</div>
            <pre className="mt-2 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--soft)] p-3 font-mono text-[10px]">{iframe}</pre>
          </div>
        </aside>
      </div>
    </div>
  );
}
