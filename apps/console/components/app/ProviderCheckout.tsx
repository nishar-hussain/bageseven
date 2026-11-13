'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { billingApi, type Plan } from '../../lib/billing-client';
import { BagsevenEmbed } from '../../lib/bagseven-sdk-react';
import { errorMessage } from '../../lib/error-message';
import { providerCheckoutBlockReason, type ProviderCheckoutStatus } from '../../lib/provider-checkout';
import { useOperator } from '../../lib/use-operator';
import { useFeatures } from '../../lib/use-features';
import { ConnectWallet } from '../wallet/ConnectWallet';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard } from './ui';

export function ProviderCheckout({ creditsOnly = false }: { creditsOnly?: boolean }) {
  const op = useOperator();
  const { features } = useFeatures();
  const params = useSearchParams();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [gas, setGas] = useState<ProviderCheckoutStatus | null>(null);
  const [planId, setPlanId] = useState(params.get('plan_id') || '');
  const [session, setSession] = useState(params.get('session') || '');
  const [holder, setHolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const providerMode = op.status?.dual_gate.provider_funded_gas !== false;
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [result, status] = await Promise.all([
        billingApi.listPlans(),
        providerMode ? fetch('/api/provider-gas', { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then(async res => {
          const data = await res.json();
          if (!res.ok) throw new Error(errorMessage(data.error, 'Provider status unavailable'));
          return data as ProviderCheckoutStatus;
        }) : Promise.resolve(null),
      ]);
      setPlans(result.plans); setGas(status);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, [providerMode]);
  useEffect(() => { if (op.holder) void refresh(); }, [op.holder, refresh]);
  const available = plans.filter(plan => plan.active && (!providerMode || plan.provider_id !== 'legacy') && (!creditsOnly || features.find(feature => feature.id === plan.feature)?.value_type !== 'boolean') && (!params.get('feature') || plan.feature === params.get('feature')));
  const selected = available.find(plan => plan.id === planId);
  const booleanAccess = features.find(feature => feature.id === selected?.feature)?.value_type === 'boolean';
  const blocked = providerMode ? providerCheckoutBlockReason(gas) : null;
  const buyer = holder.trim() || op.holder;

  async function openCheckout() {
    if (!selected || !buyer || blocked) return;
    setBusy(true); setError('');
    try {
      // Server resolves price, recipient, credits and duration from this plan.
      // Human checkout does not require the deployment's optional MCP worker.
      const result = await billingApi.createCheckout({ plan_id: selected.id, holder: buyer });
      setSession(result.session.id);
      router.replace(`${creditsOnly ? '/app/credits' : '/app/mint'}?${new URLSearchParams({ session: result.session.id })}`);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-3xl space-y-5">
    <PageHeader title={creditsOnly ? 'Buy credits' : 'Create entitlement'} description="Choose a provider plan. The buyer pays its provider directly, then verified payment issues living access on Registry." />
    {session ? <>
      <BagsevenEmbed key={session} apiUrl="/api/public" checkoutSessionId={session} initialView="checkout" mode="inline" walletSlot={<ConnectWallet />} />
      <p className="text-sm text-[var(--muted)]">After payment confirmation, open Entitlements to use the purchased access.</p>
    </> : <SoftCard className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Provider plan checkout</h2><SecondaryButton onClick={() => void refresh()} disabled={loading || busy}>Refresh</SecondaryButton></div>
      {!op.loading && !op.holder ? <p>Sign in to create a checkout.</p> : loading ? <p className="text-sm text-[var(--muted)]">Loading plans and provider status…</p> : <>
        {blocked ? <div className="rounded-xl border border-[var(--line)] bg-[var(--soft)] p-3 text-sm"><p>{blocked}</p><Link href="/app/settings#provider-gas" className="mt-2 inline-block font-semibold text-[var(--blue)] underline">Configure provider gas in Tracks</Link></div> : null}
        {available.length ? <>
          <label className="block text-sm font-semibold">Plan
            <select value={planId} onChange={event => setPlanId(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 font-normal">
              <option value="">Choose a plan</option>
              {available.map(plan => <option key={plan.id} value={plan.id}>{plan.name} — {plan.amount} stablecoin</option>)}
            </select>
          </label>
          {selected ? <div className="space-y-1 rounded-xl bg-[var(--soft)] p-3 text-sm">
            <p><strong>{selected.amount} stablecoin</strong> · {booleanAccess ? 'Feature access' : `${selected.credits} usage credits`} · {selected.feature}</p>
            <p>Access period: {selected.ttl_seconds} seconds · {selected.interval === 'month' ? 'Monthly renewal option' : 'One-time purchase'}</p>
            <p className="break-all">Provider receives payment at {selected.merchant_wallet}</p>
            <p className="text-[var(--muted)]">The 0.1% platform fee is billed separately to the provider.</p>
          </div> : null}
          <label className="block text-sm font-semibold">Entitlement holder
            <input value={holder} placeholder={op.holder} onChange={event => setHolder(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5 font-normal" />
          </label>
          <p className="text-xs text-[var(--muted)]">Leave blank for your signed-in account. Enter a customer holder only when creating their checkout.</p>
          <PrimaryButton disabled={busy || !selected || !buyer || Boolean(blocked)} onClick={() => void openCheckout()}>{busy ? 'Opening checkout…' : 'Continue to wallet checkout'}</PrimaryButton>
        </> : <div className="space-y-2 text-sm"><p>No active provider plans are available{params.get('feature') ? ' for this feature' : ''}. Create a plan with its price, credits, duration and payout wallet first.</p><PrimaryButton href="/app/plans">Create a provider plan</PrimaryButton></div>}
      </>}
    </SoftCard>}
    {error ? <p role="alert" className="whitespace-pre-wrap text-sm text-[var(--bad)]">{error}</p> : null}
    <div className="flex gap-4 text-sm font-semibold text-[var(--blue)]"><Link href="/app/grants">View entitlements</Link><Link href="/app/plans">Manage plans</Link><Link href="/app/settings">Provider settings</Link></div>
  </div>;
}
