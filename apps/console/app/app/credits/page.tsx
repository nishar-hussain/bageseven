'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi } from '../../../lib/entitlements-client';

export default function CreditsPage() {
  const [holder, setHolder] = useState('demo-human');
  const [amount, setAmount] = useState('1.00');
  const [remaining, setRemaining] = useState('10');
  const [ttl, setTtl] = useState(120);
  const [paymentTx, setPaymentTx] = useState('');
  const [msg, setMsg] = useState('');

  const buy = async () => {
    setMsg('Settling…');
    try {
      const r = await entitlementsApi.buyCredits({
        feature: 'ocr',
        holder,
        amount,
        remaining,
        ttl_seconds: ttl,
        payment_tx: paymentTx.trim() || undefined,
        world_proof_id: 'world:ok:buyer',
      });
      setMsg(`mode=${r.settlement?.mode ?? '?'} · ${r.settlement?.payment_tx} · ${r.settlement?.hashscan_url}\ngrant=${r.grant.id}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Credits</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Hedera settle → stamp payment_tx → HashScan.</p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div className="rounded-2xl border border-orange-200 bg-[var(--warn-t)] px-4 py-3 text-sm text-[var(--ink)]">
        If status shows <strong>Demo settle</strong>, set <code className="fi-mono text-xs">HEDERA_X402_FACILITATOR_URL</code> for
        live settle, or paste a real HashScan tx below.
      </div>

      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="fi-field">
          <label htmlFor="holder">Holder</label>
          <input id="holder" value={holder} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="fi-field">
            <label htmlFor="amount">Amount</label>
            <input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="remaining">Credits</label>
            <input id="remaining" value={remaining} onChange={(e) => setRemaining(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="ttl">TTL seconds</label>
            <input id="ttl" type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
          </div>
        </div>
        <div className="fi-field">
          <label htmlFor="paymentTx">Existing payment_tx (optional)</label>
          <input id="paymentTx" className="fi-mono text-sm" value={paymentTx} onChange={(e) => setPaymentTx(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void buy()} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white">
            Buy credits
          </button>
          <Link href="/app/grants" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
            View grants
          </Link>
        </div>
        {msg && <pre className="fi-mono whitespace-pre-wrap text-xs text-[var(--muted)]">{msg}</pre>}
      </div>
    </div>
  );
}
