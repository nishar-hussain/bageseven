'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GrantList } from '../../../components/app/GrantList';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi } from '../../../lib/entitlements-client';

export default function GrantsPage() {
  const [grantId, setGrantId] = useState('');
  const [amount, setAmount] = useState('1');
  const [work, setWork] = useState('ocr unit');
  const [msg, setMsg] = useState('');

  const paidRun = async () => {
    setMsg('Running…');
    try {
      const r = await entitlementsApi.paidRun({
        grant_id: grantId,
        amount,
        work,
        skip_mandate_gate: true, // console demo: grant gate only until worker/mandate bound
      });
      setMsg(`OK remaining=${r.grant.remaining}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const cancel = async () => {
    if (!grantId) return;
    setMsg('Cancelling renewal…');
    try {
      const r = await entitlementsApi.cancelRenewal(grantId);
      setMsg(`Renewal ${r.grant.renewal_enabled ? 'on' : 'off'} · access until ${r.grant.paid_through}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const explain = async () => {
    setMsg('…');
    try {
      const r = await entitlementsApi.explainDenial({
        grant_id: grantId || undefined,
        feature: 'ocr',
        world_proof_id: 'world:expire:demo',
      });
      setMsg(r.reasons.map((x) => `${x.code}: ${x.detail}`).join(' · '));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Entitlements</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Living Arkiv grants — TTL, remaining credits, HashScan.</p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <GrantList feature="ocr" />

      <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)] space-y-4">
        <div>
          <h2 className="text-base font-semibold">Dual-gate actions</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Paste a grant id. Paid run burns credits (local mandate skip when worker missing).</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="fi-field">
            <label htmlFor="grantId">Grant id</label>
            <input id="grantId" className="fi-mono text-sm !rounded-xl" value={grantId} onChange={(e) => setGrantId(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="amount">Amount</label>
            <input id="amount" className="!rounded-xl" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="work">Work note</label>
            <input id="work" className="!rounded-xl" value={work} onChange={(e) => setWork(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void paidRun()} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white">
            Paid run
          </button>
          <button type="button" onClick={() => void cancel()} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
            Cancel renewal
          </button>
          <button type="button" onClick={() => void explain()} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
            Explain denial
          </button>
          <Link href="/app/mint" className="rounded-full bg-[var(--blue)] px-4 py-2 text-sm font-semibold text-white">
            Mint
          </Link>
        </div>
        {msg && <p className="fi-mono text-xs text-[var(--muted)]">{msg}</p>}
      </div>
    </div>
  );
}
