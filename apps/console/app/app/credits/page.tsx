'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authorizeWhitechainPayment, payUsdtOnWhitechain } from '../../../lib/bagseven-sdk-wallet';
import { PageHeader, SoftCard } from '../../../components/app/ui';
import { entitlementsApi } from '../../../lib/entitlements-client';
import { TTL_PRESETS, shortId, useOperator } from '../../../lib/use-operator';
import { featureLabel, useFeatures } from '../../../lib/use-features';
import { identityLabel } from '../../../lib/identity-label';

export default function CreditsPage() {
  const op = useOperator();
  const { features } = useFeatures();
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
      let tx = paymentTx.trim() || undefined;
      let authorization: { customer_wallet?: string; payment_signature?: string } = {};
      const rail = op.status?.tracks.whitechain;
      if (!rail) throw new Error('Payment configuration is still loading');
      if (!tx && !rail.demo_settle && !rail.operator) {
        if (!rail.pay_to || !rail.usdt) {
          throw new Error(
            'Whitechain payment recipient is not configured. Set WHITECHAIN_PAY_TO (or WHITECHAIN_PRIVATE_KEY) in .env, restart the daemon, then open Tracks.',
          );
        }
        const paid = await payUsdtOnWhitechain({
          merchantWallet: rail.pay_to,
          amount,
          usdt: rail.usdt,
          chainId: rail.chain_id,
          context: `entitlement:${op.holder}:${feature}:${amount}`,
        });
        tx = paid.payment_tx;
        authorization = paid;
        setPaymentTx(tx);
      }
      if (tx && !authorization.payment_signature && !rail.demo_settle) {
        authorization = await authorizeWhitechainPayment({
          payment_tx: tx,
          context: `entitlement:${op.holder}:${feature}:${amount}`,
          chainId: rail.chain_id,
        });
      }
      const r = await entitlementsApi.buyCredits({
        feature,
        holder: op.holder,
        amount,
        remaining,
        ttl_seconds: ttl,
        payment_tx: tx,
        ...authorization,
        // Reuses World proof from a living grant for this holder (mint with IDKit first).
      });
      setPaymentTx('');
      setMsg(
        `Topped up ${featureLabel(feature, features)} for ${identityLabel(op.holder)}. ` +
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
      <PageHeader title="Buy credits" description="Top up an existing entitlement on Whitechain." />

      {op.status?.tracks.whitechain.demo_settle ? (
        <div className="rounded-2xl border border-orange-200 bg-[var(--warn-t)] px-4 py-3 text-sm text-[var(--ink)]">
          Whitechain settle is not wired. Configure operator keys on Tracks, or paste a real payment tx below.
        </div>
      ) : null}

      <SoftCard className="space-y-4 p-5">
        <p className="text-sm text-[var(--muted)]">
          Buyer: <strong className="break-words text-[var(--ink)]" title={op.holder}>{identityLabel(op.holder)}</strong>
        </p>
        <div className="fi-field">
          <label htmlFor="feature">Feature SKU to top up</label>
          <select id="feature" value={feature} onChange={(e) => setFeature(e.target.value)} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} — {f.blurb}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="fi-field">
            <label htmlFor="amount">Pay (USDT.e)</label>
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
        {msg && <pre className="break-words whitespace-pre-wrap text-sm text-[var(--muted)]">{msg}</pre>}
      </SoftCard>
    </div>
  );
}
