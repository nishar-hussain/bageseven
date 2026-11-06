'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi } from '../../../lib/entitlements-client';
import { FEATURE_OPTIONS, TTL_PRESETS, featureLabel, shortId, useOperator } from '../../../lib/use-operator';

export default function CreditsPage() {
  const op = useOperator();
  const [feature, setFeature] = useState('ocr');
  const [amount, setAmount] = useState('1.00');
  const [remaining, setRemaining] = useState('10');
  const [ttl, setTtl] = useState(900);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [paymentTx, setPaymentTx] = useState('');

  const buy = async () => {
    if (!op.holder) {
      setMsg('Sign in first.');
      return;
    }
    setBusy(true);
    setMsg('Settling on Whitechain…');
    try {
      const r = await entitlementsApi.buyCredits({
        feature,
        holder: op.holder,
        amount,
        remaining,
        ttl_seconds: ttl,
        payment_tx: paymentTx.trim() || undefined,
        // Reuses World proof from a living grant for this holder (mint with IDKit first).
      });
      setMsg(
        `Topped up ${featureLabel(feature)} for ${op.holder}. ` +
          `${r.settlement?.mode ?? 'settle'} · grant ${shortId(r.grant.id)} · ${r.grant.remaining} credits left` +
          (r.settlement?.explorer_url ? `\n${r.settlement.explorer_url}` : ''),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Buy credits</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Top up credits on an existing entitlement (Whitechain settle). Pick the same feature SKU you already entitled.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      {op.status?.tracks.whitechain.demo_settle && (
        <div className="rounded-2xl border border-orange-200 bg-[var(--warn-t)] px-4 py-3 text-sm text-[var(--ink)]">
          Whitechain is in <strong>demo settle</strong> mode. Set WHITECHAIN_PRIVATE_KEY + WHITECHAIN_PAY_TO or paste a real explorer tx for a live stamp.
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <p className="text-sm text-[var(--muted)]">
          Buyer: <strong className="text-[var(--ink)]">{op.holder || '…'}</strong>
        </p>
        <div className="fi-field">
          <label htmlFor="feature">Feature SKU to top up</label>
          <select id="feature" value={feature} onChange={(e) => setFeature(e.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
            {FEATURE_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} — {f.blurb}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="fi-field">
            <label htmlFor="amount">Pay (USDC)</label>
            <input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="remaining">Credits added</label>
            <input id="remaining" value={remaining} onChange={(e) => setRemaining(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="ttl">Access lasts</label>
            <select id="ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
              {TTL_PRESETS.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !op.holder} onClick={() => void buy()} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Settling…' : 'Buy credits'}
          </button>
          <Link href="/app/grants" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
            View entitlements
          </Link>
          <button type="button" className="text-xs text-[var(--muted)] underline" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide advanced' : 'Paste existing payment tx'}
          </button>
        </div>
        {showAdvanced && (
          <div className="fi-field">
            <label htmlFor="paymentTx">Whitechain payment_tx</label>
            <input id="paymentTx" className="fi-mono text-sm" value={paymentTx} onChange={(e) => setPaymentTx(e.target.value)} placeholder="Optional — leave blank to settle now" />
          </div>
        )}
        {msg && <pre className="whitespace-pre-wrap text-sm text-[var(--muted)]">{msg}</pre>}
      </div>
    </div>
  );
}
