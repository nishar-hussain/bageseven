'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Entitlement, Subscription } from './types.js';
import { authorizeWhitechainPayment, connectWhitechainWallet, payUsdtOnWhitechain, subscribeOnWhitechain, cancelWhitechainSubscription, renewSubscriptionAllowance } from './wallet.js';
import { resolveEmbedComponent, type EmbedComponentId } from './components.js';

export type EmbedView = 'portal' | 'checkout' | 'consume' | 'credits' | 'unsubscribe' | 'pricing' | 'customer';

type PublicPlan = {
  id: string;
  name: string;
  feature: string;
  amount: string;
  credits: string;
  interval: 'once' | 'month';
  ttl_seconds: number;
  merchant_wallet: string;
  active: boolean;
};

type PublicCheckout = {
  subscription_plan?: { status: string; address: string; chain_id: number; subscribe_data: string } | null;
  expires_at: string;
  id: string;
  status: string;
  amount: string;
  holder: string;
  payment_tx?: string;
  chain_id: number;
  payment: { chain_id: number; usdt: string };
  plan: {
    id: string;
    name: string;
    feature: string;
    amount: string;
    credits: string;
    interval?: 'once' | 'month';
    merchant_wallet: string;
  } | null;
};

/** Schematic-style theme tokens — override via CSS vars on a parent. */
const rootStyle = {
  ['--bs-ink' as string]: 'var(--bagseven-ink, #0f172a)',
  ['--bs-muted' as string]: 'var(--bagseven-muted, #64748b)',
  ['--bs-faint' as string]: 'var(--bagseven-faint, #94a3b8)',
  ['--bs-line' as string]: 'var(--bagseven-line, #e2e8f0)',
  ['--bs-soft' as string]: 'var(--bagseven-soft, #f8fafc)',
  ['--bs-card' as string]: 'var(--bagseven-card, #ffffff)',
  ['--bs-accent' as string]: 'var(--bagseven-accent, #0f172a)',
  ['--bs-good' as string]: 'var(--bagseven-good, #047857)',
  ['--bs-good-bg' as string]: 'var(--bagseven-good-bg, #ecfdf5)',
  ['--bs-warn' as string]: 'var(--bagseven-warn, #b45309)',
  ['--bs-warn-bg' as string]: 'var(--bagseven-warn-bg, #fffbeb)',
  ['--bs-radius' as string]: 'var(--bagseven-radius, 16px)',
  fontFamily: 'var(--bagseven-font, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif)',
  color: 'var(--bs-ink)',
  maxWidth: 720,
  overflowWrap: 'anywhere',
  margin: '0 auto',
  WebkitFontSmoothing: 'antialiased',
} as CSSProperties;

async function publicGet<T>(apiUrl: string, path: string, token: string): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Bagseven GET ${path} failed (${res.status})`);
  return json;
}

async function publicPost<T>(apiUrl: string, path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Bagseven POST ${path} failed (${res.status})`);
  return json;
}

function periodLabel(seconds: number): string {
  if (seconds >= 86400) return `${Math.round(seconds / 86400)} day access`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour access`;
  return `${Math.round(seconds / 60)} min access`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Card({
  children,
  style,
  highlight,
}: {
  children: ReactNode;
  style?: CSSProperties;
  highlight?: boolean;
}) {
  return (
    <div
      className="bagseven-card"
      style={{
        background: 'var(--bs-card)',
        border: `1px solid ${highlight ? 'var(--bs-ink)' : 'var(--bs-line)'}`,
        borderRadius: 'var(--bs-radius)',
        padding: 20,
        boxShadow: highlight ? '0 0 0 1px var(--bs-ink)' : '0 1px 2px rgba(15,23,42,0.04)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  const bg = tone === 'good' ? 'var(--bs-good-bg)' : tone === 'warn' ? 'var(--bs-warn-bg)' : 'var(--bs-soft)';
  const color = tone === 'good' ? 'var(--bs-good)' : tone === 'warn' ? 'var(--bs-warn)' : 'var(--bs-muted)';
  return (
    <span
      className="bagseven-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 650,
        letterSpacing: '0.01em',
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
  outline,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  outline?: boolean;
}) {
  return (
    <button
      type="button"
      className="bagseven-cta"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: '100%',
        border: outline ? '1px solid var(--bs-line)' : 0,
        borderRadius: 999,
        padding: '11px 16px',
        background: disabled ? '#cbd5e1' : outline ? '#fff' : 'var(--bs-accent)',
        color: outline ? 'var(--bs-ink)' : '#fff',
        fontWeight: 650,
        fontSize: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'opacity 120ms ease',
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return <PrimaryBtn outline disabled={disabled} onClick={onClick}>{children}</PrimaryBtn>;
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0, marginTop: 2 }}>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="var(--bs-good)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CreditBar({ remaining, allocation }: { remaining: string; allocation: string }) {
  const rem = Math.max(0, Number(remaining) || 0);
  const alloc = Math.max(rem, Number(allocation) || rem || 1);
  const pct = Math.min(100, Math.round((rem / alloc) * 100));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--bs-muted)', marginBottom: 6 }}>
        <span>
          <strong style={{ color: 'var(--bs-ink)' }}>{remaining}</strong> of {allocation || remaining} credits
        </span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'var(--bs-soft)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--bs-accent)',
            borderRadius: 999,
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  );
}

function Skeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 120,
            borderRadius: 'var(--bs-radius)',
            background: 'linear-gradient(90deg, var(--bs-soft) 25%, #eef2f7 50%, var(--bs-soft) 75%)',
            backgroundSize: '200% 100%',
          }}
        />
      ))}
    </div>
  );
}

export type EmbedTheme = {
  ink?: string;
  accent?: string;
  soft?: string;
  radius?: string;
  font?: string;
};

/**
 * Schematic-style drop-in billing UI.
 * Pass `component` (cmp_pricing | cmp_checkout | cmp_portal | cmp_customer).
 * Theme via `theme` props or parent CSS `--bagseven-*` variables.
 */
export function BagsevenEmbed({
  accessToken,
  apiUrl = '/api/public',
  initialView = 'portal',
  mode = 'inline',
  publishableKey,
  checkoutSessionId,
  planIds,
  component,
  holder,
  theme,
  heading,
  ctaLabel = 'Choose plan',
  showPoweredBy = true,
  walletSlot,
}: {
  accessToken?: string;
  apiUrl?: string;
  initialView?: EmbedView;
  mode?: 'inline' | 'modal';
  publishableKey?: string;
  checkoutSessionId?: string;
  /** Optional storefront selection; checkout still authorizes the selected plan on the server. */
  planIds?: string[];
  component?: EmbedComponentId | string;
  holder?: string;
  theme?: EmbedTheme;
  /** Override pricing / portal title */
  heading?: string;
  /** Primary plan CTA when signed in */
  ctaLabel?: string;
  showPoweredBy?: boolean;
  /** Host app wallet UI (e.g. RainbowKit ConnectButton) shown above checkout */
  walletSlot?: ReactNode;
}) {
  const resolved = resolveEmbedComponent(component);
  const startView: EmbedView =
    resolved?.view === 'customer'
      ? 'customer'
      : (resolved?.view ?? (checkoutSessionId ? 'checkout' : initialView));
  const [view, setView] = useState<EmbedView>(startView);

  // Keep in sync when host swaps `component=` (Builder preview / demo tabs).
  useEffect(() => {
    setView(startView);
  }, [startView]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [checkoutSubscription, setCheckoutSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [period, setPeriod] = useState<'month' | 'once'>('month');
  const [checkout, setCheckout] = useState<PublicCheckout | null>(null);
  const [sessionId, setSessionId] = useState(checkoutSessionId ?? '');
  const [demoTx, setDemoTx] = useState('');
  useEffect(() => {
    if (!checkout?.id) return;
    try { setDemoTx(sessionStorage.getItem(`bagseven-payment:${checkout.id}`) ?? checkout.payment_tx ?? ''); }
    catch { setDemoTx(checkout.payment_tx ?? ''); }
  }, [checkout?.id, checkout?.payment_tx]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const base = apiUrl.replace(/\/$/, '');
  const token = accessToken || publishableKey || '';
  const single = Boolean(resolved);

  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const request = ++loadGeneration.current;
    if (!accessToken) {
      setLoading(false);
      return;
    }
    const data = await publicGet<{ entitlements: Entitlement[] }>(base, '/entitlements', accessToken).catch(error => {
      if (request !== loadGeneration.current) return null;
      throw error;
    });
    if (!data || request !== loadGeneration.current) return;
    const subscribed = await publicGet<{ subscriptions: Subscription[] }>(base, '/subscriptions', accessToken);
    if (request !== loadGeneration.current) return;
    setSubscriptions(subscribed.subscriptions);
    setEntitlements(data.entitlements ?? []);
    setLoading(false);
  }, [accessToken, base]);

  const loadPlans = useCallback(async () => {
    const auth = publishableKey || token;
    if (!auth) return;
    const data = await publicGet<{ plans: PublicPlan[] }>(base, '/plans?active=true', auth);
    setPlans((data.plans ?? []).filter((p) => p.active && (!planIds || planIds.includes(p.id))));
  }, [publishableKey, token, base, planIds]);

  const loadCheckout = useCallback(
    async (id?: string) => {
      const sid = id ?? sessionId;
      if (!sid) return;
      const res = await fetch(`${base}/public/checkout/${encodeURIComponent(sid)}`);
      const json = (await res.json().catch(() => ({}))) as { session?: PublicCheckout; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `checkout ${res.status}`);
      setCheckout(json.session ?? null);
      if (json.session?.status === 'PAID') {
        const state = await fetch(`${base}/public/checkout/${encodeURIComponent(sid)}/subscription`).then(r => r.json()) as { subscription?: Subscription };
        setCheckoutSubscription(state.subscription ?? null);
      }
      setSessionId(sid);
      return json.session;
    },
    [base, sessionId],
  );

  useEffect(() => {
    const requests = loadGeneration;
    const update = () => void load().catch((e) => {
      setEntitlements([]);
      setMsg(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
    update();
    const timer = setInterval(() => { if (!document.hidden) update(); }, 15000);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); requests.current++; };
  }, [load]);

  useEffect(() => {
    if (view === 'pricing' || startView === 'pricing' || view === 'customer') {
      void loadPlans().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
    }
  }, [view, startView, loadPlans]);

  useEffect(() => {
    if (checkoutSessionId) void loadCheckout(checkoutSessionId).catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [checkoutSessionId, loadCheckout]);

  useEffect(() => {
    if (checkout?.status !== 'PENDING' || checkout.subscription_plan?.status !== 'preparing') return;
    const timer = setInterval(() => void loadCheckout().catch(e => setMsg(String(e))), 5000);
    return () => clearInterval(timer);
  }, [checkout?.status, checkout?.subscription_plan?.status, loadCheckout]);

  const cancelSubscription = async (sub: Subscription) => {
    await cancelWhitechainSubscription({ contract: sub.contract, key: sub.subscription_key, payer: sub.payer, chainId: sub.chain_id, cancelData: sub.cancel_data });
    if (accessToken) await publicPost(base, `/subscriptions/${encodeURIComponent(sub.id)}/sync`, accessToken, {});
    else await fetch(`${base}/public/checkout/${encodeURIComponent(sub.checkout_id)}/subscription/sync`, { method: 'POST' }).then(async r => { if (!r.ok) throw new Error((await r.json()).error?.message || 'Cancellation confirmed; status sync needs retry'); });
    await loadCheckout(sub.checkout_id);
    setMsg('Renewal cancelled on Whitechain. Already-paid access remains until the period ends.');
  };
  const subscriptionCard = (sub: Subscription) => (
    <Card key={sub.id}>
      <strong>{sub.feature} · {sub.amount} USDT every {Math.round(sub.period_seconds / 86400)} days</strong>
      <p>{sub.status} · Paid through {formatWhen(sub.paid_through)}</p>
      {!['CANCELLED', 'ENDED'].includes(sub.status) && <p>Next collection attempt: {formatWhen(sub.next_attempt_at)}</p>}
      {sub.last_error && <p role="status">{sub.last_error}</p>}
      <p style={{ fontSize: 12 }}>Payments are collected from your wallet within the approved plan terms. Your wallet needs USDT balance and allowance. Wallet approval and cancellation use WBT for gas.</p>
      {!['CANCELLED', 'ENDED'].includes(sub.status) && <>
        <GhostBtn disabled={busy} onClick={() => void act(() => cancelSubscription(sub))}>Cancel recurring payment with wallet</GhostBtn>
        <GhostBtn disabled={busy} onClick={() => void act(async () => {
          await renewSubscriptionAllowance({ contract: sub.contract, payer: sub.payer, chainId: sub.chain_id, usdt: sub.token, amount: sub.amount });
          setMsg('USDT allowance authorized for up to 12 charges. The next due attempt uses this permission; no payment was collected by this action.');
        })}>Authorize next 12 charges</GhostBtn>
      </>}
    </Card>
  );

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      await load();
      if (sessionId) await loadCheckout(sessionId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startCheckout = async (planId: string) => {
    if (!accessToken) throw new Error('Customer accessToken required — identify the holder first');
    if (!holder) throw new Error('holder required to start checkout');
    const r = await publicPost<{ session: PublicCheckout }>(base, '/checkout-sessions', accessToken, {
      plan_id: planId,
      holder,
    });
    setSessionId(r.session.id);
    setCheckout(r.session);
    setView('checkout');
    await loadCheckout(r.session.id);
  };

  const cancelRenewal = async (grantId: string) => {
    if (!accessToken) throw new Error('accessToken required');
    const sub = subscriptions.find(s => s.grant_id === grantId && !['CANCELLED', 'ENDED'].includes(s.status));
    if (sub) await cancelSubscription(sub);
    else await publicPost(base, `/entitlements/${encodeURIComponent(grantId)}/cancel-renewal`, accessToken, {});
    setConfirmCancel(null);
    setMsg('Renewal cancelled — access stays until the period ends');
  };

  const ownedFeatures = useMemo(() => new Set(entitlements.filter((e) => e.enabled).map((e) => e.feature)), [entitlements]);

  const hasMonth = plans.some((p) => p.interval === 'month');
  const hasOnce = plans.some((p) => p.interval === 'once');
  const visiblePlans = useMemo(() => {
    if (hasMonth && hasOnce) {
      const filtered = plans.filter((p) => p.interval === period);
      return filtered.length ? filtered : plans;
    }
    return plans;
  }, [plans, period, hasMonth, hasOnce]);

  const pricingBody = (
    <section className="bagseven-pricing-table" data-state={plans.length ? 'ready' : 'empty'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{heading || 'Plans'}</h3>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.5, maxWidth: 360 }}>
            Choose a plan to unlock entitlements. Monthly subscriptions collect every 30 days after wallet authorization.
          </p>
        </div>
        {hasMonth && hasOnce ? (
          <div
            className="bagseven-toggle"
            role="group"
            aria-label="Billing period"
            style={{ display: 'flex', background: 'var(--bs-soft)', borderRadius: 999, padding: 3, gap: 2 }}
          >
            {(['month', 'once'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                style={{
                  border: 0,
                  borderRadius: 999,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 650,
                  background: period === p ? 'var(--bs-card)' : 'transparent',
                  color: period === p ? 'var(--bs-ink)' : 'var(--bs-muted)',
                  boxShadow: period === p ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                  cursor: 'pointer',
                }}
              >
                {p === 'month' ? 'Monthly' : 'One-time'}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {visiblePlans.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: 'var(--bs-muted)', fontSize: 13 }}>No plans yet. Create one in the Bagseven console.</p>
        </Card>
      ) : (
        <ul
          className="bagseven-pricing-table__plans"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: visiblePlans.length > 1 ? 'repeat(auto-fit, minmax(220px, 1fr))' : '1fr',
            gap: 14,
          }}
        >
          {visiblePlans.map((p) => {
            const isBool = Number(p.credits) === 1;
            const isCurrent = ownedFeatures.has(p.feature);
            return (
              <li key={p.id} style={{ margin: 0 }}>
                <Card highlight={isCurrent} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</div>
                    {isCurrent ? <Badge tone="good">Current</Badge> : null}
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 750, letterSpacing: '-0.03em', lineHeight: 1 }}>{p.amount}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bs-muted)' }}>
                      USDT{p.interval === 'month' ? '/mo' : ''}
                    </span>
                  </div>
                  <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 8, flex: 1 }}>
                    <li style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--bs-ink)', lineHeight: 1.4 }}>
                      <CheckIcon />
                      <span>
                        <strong>{p.feature}</strong>
                        {isBool ? ' — unlimited access' : ` — ${p.credits} credits`}
                      </span>
                    </li>
                    <li style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.4 }}>
                      <CheckIcon />
                      <span>{periodLabel(p.ttl_seconds)}</span>
                    </li>
                    {p.interval === 'month' ? (
                      <li style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.4 }}>
                        <CheckIcon />
                        <span>Renews until cancelled</span>
                      </li>
                    ) : null}
                  </ul>
                  <div style={{ marginTop: 18 }}>
                    {isCurrent ? (
                      <div
                        style={{
                          textAlign: 'center',
                          fontSize: 13,
                          fontWeight: 650,
                          color: 'var(--bs-good)',
                          padding: '11px 0',
                        }}
                      >
                        Current plan
                      </div>
                    ) : (
                      <PrimaryBtn disabled={busy || !accessToken} onClick={() => void act(async () => startCheckout(p.id))}>
                        {busy ? 'Starting…' : accessToken ? ctaLabel : 'Sign in to subscribe'}
                      </PrimaryBtn>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const portalBody = (
    <section className="bagseven-plan-manager">
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{heading || 'Your plan'}</h3>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.5 }}>
          Active entitlements, usage, and renewal.
        </p>
      </div>
      {loading ? (
        <Skeleton />
      ) : entitlements.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>No active subscription</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--bs-muted)' }}>
            Pick a plan to unlock features for this account.
          </p>
          <div style={{ marginTop: 14 }}>
            <PrimaryBtn onClick={() => setView('pricing')}>Browse plans</PrimaryBtn>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {entitlements.map((e) => {
            const live = e.enabled;
            const renewing = subscriptions.some(s => s.grant_id === e.grant_id && !['CANCELLED', 'ENDED'].includes(s.status));
            return (
              <Card key={e.grant_id ?? e.feature}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{e.feature}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                    <Badge tone={live ? 'good' : 'warn'}>{live ? 'Active' : 'Expired'}</Badge>
                    <Badge tone={renewing ? 'good' : 'neutral'}>{renewing ? 'Auto-renew' : 'Ends this period'}</Badge>
                    <Badge>{e.value_type === 'boolean' ? 'Access' : 'Metered'}</Badge>
                  </div>
                </div>

                {e.value_type === 'boolean' ? (
                  <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.5 }}>
                    {live ? 'Access is on' : 'Access is off'} until{' '}
                    <strong style={{ color: 'var(--bs-ink)' }}>{formatWhen(e.paid_through)}</strong>
                  </p>
                ) : (
                  <>
                    <CreditBar remaining={e.remaining} allocation={e.allocation || e.remaining} />
                    {live && accessToken ? (
                      <div style={{ marginTop: 12 }}>
                        <GhostBtn
                          disabled={busy || Number(e.remaining) <= 0}
                          onClick={() =>
                            void act(async () => {
                              await publicPost(base, '/usage/consume', accessToken, {
                                feature: e.feature,
                                amount: '1',
                                idempotencyKey: `embed-${e.feature}-${Date.now()}`,
                              });
                              setMsg(`Used 1 ${e.feature} credit`);
                            })
                          }
                        >
                          {busy ? 'Working…' : 'Use 1 credit'}
                        </GhostBtn>
                      </div>
                    ) : null}
                  </>
                )}

                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid var(--bs-line)',
                    fontSize: 12,
                    color: 'var(--bs-faint)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span>Period ends {formatWhen(e.paid_through)}</span>
                  {e.explorer_url ? (
                    <>
                      <span>·</span>
                      <a href={e.explorer_url} target="_blank" rel="noreferrer" style={{ color: 'var(--bs-ink)', fontWeight: 600 }}>
                        View payment
                      </a>
                    </>
                  ) : null}
                </div>

                {renewing && e.grant_id ? (
                  <div style={{ marginTop: 14 }}>
                    {confirmCancel === e.grant_id ? (
                      <div style={{ display: 'grid', gap: 10 }}>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.45 }}>
                          Cancel renewal? You’ll keep access until <strong style={{ color: 'var(--bs-ink)' }}>{formatWhen(e.paid_through)}</strong>.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <GhostBtn disabled={busy} onClick={() => setConfirmCancel(null)}>
                            Keep plan
                          </GhostBtn>
                          <PrimaryBtn disabled={busy} onClick={() => void act(async () => cancelRenewal(e.grant_id!))}>
                            {busy ? 'Cancelling…' : 'Confirm cancel'}
                          </PrimaryBtn>
                        </div>
                      </div>
                    ) : (
                      <GhostBtn disabled={busy || !accessToken} onClick={() => setConfirmCancel(e.grant_id)}>
                        Cancel renewal
                      </GhostBtn>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
      {subscriptions.length > 0 && <div style={{ display: 'grid', gap: 12, marginTop: 16 }}><h3>Recurring payments</h3>{subscriptions.map(subscriptionCard)}</div>}
    </section>
  );

  const checkoutBody = (
    <section className="bagseven-checkout">
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Checkout</h3>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.5 }}>
          Pay with Whitechain testnet USDT. Entitlement goes live when payment confirms.
        </p>
      </div>
      {!sessionId ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--bs-muted)' }}>Pick a plan from Pricing to start checkout.</p>
          <div style={{ marginTop: 12 }}>
            <GhostBtn onClick={() => setView('pricing')}>Back to plans</GhostBtn>
          </div>
        </Card>
      ) : null}
      {checkout ? (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{checkout.plan?.name ?? 'Plan'}</div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--bs-muted)' }}>
                Unlocks <strong style={{ color: 'var(--bs-ink)' }}>{checkout.plan?.feature}</strong>
              </div>
            </div>
            <Badge tone={checkout.status === 'PAID' ? 'good' : 'warn'}>{checkout.status}</Badge>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 12,
              background: 'var(--bs-soft)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--bs-muted)', fontWeight: 600 }}>Due now</span>
            <span style={{ fontSize: 24, fontWeight: 750, letterSpacing: '-0.02em' }}>
              {checkout.amount}{' '}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bs-muted)' }}>USDT</span>
            </span>
          </div>

          {checkout.status === 'PAID' ? (
            <div style={{ marginTop: 16 }}>
              <p style={{ margin: 0, color: 'var(--bs-good)', fontSize: 14, fontWeight: 650 }}>
                Paid — entitlement is live for {checkout.holder}
              </p>
              {checkoutSubscription && subscriptionCard(checkoutSubscription)}
              <div style={{ marginTop: 12 }}>
                {accessToken ? <PrimaryBtn onClick={() => setView('portal')}>Go to plan manager</PrimaryBtn> : null}
              </div>
            </div>
          ) : checkout.status !== 'PENDING' && !(checkout.status === 'EXPIRED' && demoTx && checkout.plan?.interval === 'month') ? (
            <p style={{ marginTop: 16, color: 'var(--bs-muted)', fontSize: 13 }}>This checkout is {checkout.status.toLowerCase()}. Open a new checkout before paying.</p>
          ) : (
            <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
              {checkout.plan?.interval === 'month' && <p>Approve {checkout.amount} USDT every 30 days to this provider. The first payment starts access. A new allowance is limited to 12 charges; you can cancel future collections in the portal.</p>}
              <PrimaryBtn
                disabled={busy || !checkout.plan || checkout.status !== 'PENDING' || Boolean(demoTx) || (checkout.plan.interval === 'month' && checkout.subscription_plan?.status !== 'ready')}
                onClick={() =>
                  void act(async () => {
                    if (!checkout.plan) return;
                    const fresh = await loadCheckout(checkout.id);
                    if (!fresh || fresh.status !== 'PENDING' || new Date(fresh.expires_at).getTime() <= Date.now()) throw new Error('This checkout has expired or is no longer payable. Open a new checkout.');
                    const onSubmitted = (hash: string) => {
                      setDemoTx(hash);
                      try { sessionStorage.setItem(`bagseven-payment:${checkout.id}`, hash); } catch { /* Keep the receipt in memory. */ }
                    };
                    const recurring = fresh.plan?.interval === 'month';
                    if (recurring && fresh.subscription_plan?.status !== 'ready') throw new Error('Recurring plan is preparing; wait before authorizing');
                    const paid = recurring
                      ? await subscribeOnWhitechain({ contract: fresh.subscription_plan!.address, subscribeData: fresh.subscription_plan!.subscribe_data,
                          amount: fresh.amount, usdt: fresh.payment.usdt, chainId: fresh.chain_id, checkoutId: fresh.id, onTransactionSubmitted: onSubmitted })
                      : await payUsdtOnWhitechain({ merchantWallet: fresh.plan!.merchant_wallet, amount: fresh.amount,
                          chainId: fresh.chain_id, usdt: fresh.payment.usdt, context: `checkout:${fresh.id}`, onTransactionSubmitted: onSubmitted });
                    await fetch(`${base}/public/checkout/${encodeURIComponent(checkout.id)}/confirm`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(paid),
                    }).then(async (r) => {
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(j.error?.message ?? `confirm ${r.status}`);
                    });
                    setMsg('Payment confirmed — entitlement minted');
                    await loadCheckout(checkout.id);
                    if (accessToken) setView('portal');
                  })
                }
              >
                {busy ? 'Waiting for wallet…' : demoTx ? 'Payment submitted — confirm below' : checkout.plan?.interval === 'month' ? checkout.subscription_plan?.status === 'ready' ? 'Authorize subscription & pay first period' : 'Preparing recurring plan…' : 'Pay with wallet'}
              </PrimaryBtn>
              {!walletSlot ? (
                <GhostBtn
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const { address } = await connectWhitechainWallet(checkout.chain_id);
                      setMsg(`Connected ${address}`);
                    })
                  }
                >
                  Connect wallet only
                </GhostBtn>
              ) : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  value={demoTx}
                  onChange={(e) => setDemoTx(e.target.value)}
                  placeholder="Or paste tx hash 0x…"
                  style={{
                    flex: 1,
                    border: '1px solid var(--bs-line)',
                    borderRadius: 12,
                    padding: '10px 12px',
                    fontSize: 12,
                    background: '#fff',
                    color: 'var(--bs-ink)',
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !demoTx || !checkout.plan}
                  onClick={() =>
                    void act(async () => {
                      const authorization = await authorizeWhitechainPayment({
                        payment_tx: demoTx.trim(),
                        context: `checkout:${checkout.id}`,
                        chainId: checkout.chain_id,
                      });
                      await fetch(`${base}/public/checkout/${encodeURIComponent(checkout.id)}/confirm`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ payment_tx: demoTx.trim(), ...authorization }),
                      }).then(async (r) => {
                        const j = await r.json().catch(() => ({}));
                        if (!r.ok) throw new Error(j.error?.message ?? `confirm ${r.status}`);
                      });
                      setMsg('Payment verified — entitlement live');
                      await loadCheckout(checkout.id);
                      if (accessToken) setView('portal');
                    })
                  }
                  style={{
                    border: '1px solid var(--bs-line)',
                    borderRadius: 12,
                    padding: '0 14px',
                    background: '#fff',
                    fontSize: 12,
                    fontWeight: 650,
                    cursor: 'pointer',
                    color: 'var(--bs-ink)',
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </section>
  );

  /**
   * `component` only picks the *starting* surface. Never force-show the seed view
   * after internal navigation (pricing → checkout → portal), or multiple bodies stack
   * and only the last section looks “real”.
   */
  const showPricing = view === 'pricing';
  const showCheckout = view === 'checkout';
  const showPortal = view === 'portal';
  const showCustomer = view === 'customer';

  /** Full embed (no component=) gets tabs. Single-component embeds stay focused unless they navigate internally. */
  const tabs: EmbedView[] = single
    ? []
    : (['pricing', 'portal', 'checkout'] as EmbedView[]).filter((v) => v !== 'checkout' || sessionId || view === 'checkout');

  const themedRoot: CSSProperties = {
    ...rootStyle,
    ...(theme?.ink ? { ['--bagseven-ink' as string]: theme.ink, ['--bs-ink' as string]: theme.ink } : {}),
    ...(theme?.accent
      ? { ['--bagseven-accent' as string]: theme.accent, ['--bs-accent' as string]: theme.accent }
      : {}),
    ...(theme?.soft ? { ['--bagseven-soft' as string]: theme.soft, ['--bs-soft' as string]: theme.soft } : {}),
    ...(theme?.radius
      ? { ['--bagseven-radius' as string]: theme.radius, ['--bs-radius' as string]: theme.radius }
      : {}),
    ...(theme?.font ? { ['--bagseven-font' as string]: theme.font, fontFamily: theme.font } : {}),
  };

  const body = (
    <div className="bagseven-embed" style={themedRoot}>
      {walletSlot ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>{walletSlot}</div>
      ) : null}
      {resolved ? (
        <div
          style={{
            marginBottom: 14,
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--bs-faint)',
            fontWeight: 700,
          }}
        >
          {resolved.label}
        </div>
      ) : null}

      {tabs.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {tabs.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                border: `1px solid ${view === v ? 'var(--bs-ink)' : 'var(--bs-line)'}`,
                borderRadius: 999,
                padding: '7px 14px',
                background: view === v ? 'var(--bs-ink)' : '#fff',
                color: view === v ? '#fff' : 'var(--bs-muted)',
                fontSize: 12,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              {v === 'portal' ? 'Plan' : v === 'pricing' ? 'Pricing' : 'Checkout'}
            </button>
          ))}
        </div>
      ) : null}

      {showPricing && pricingBody}
      {showCheckout && checkoutBody}
      {showPortal && portalBody}
      {showCustomer && (
        <div style={{ display: 'grid', gap: 24 }}>
          {portalBody}
          <Card style={{ background: 'var(--bs-soft)', borderStyle: 'dashed' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Need a different plan?</div>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--bs-muted)', lineHeight: 1.45 }}>
              Browse pricing anytime. Cancelling renewal keeps access until the period ends.
            </p>
            <GhostBtn onClick={() => setView('pricing')}>View pricing</GhostBtn>
          </Card>
        </div>
      )}

      {view === 'unsubscribe' && !single && portalBody}

      {msg ? (
        <p
          role="status"
          style={{
            marginTop: 16,
            fontSize: 13,
            color: 'var(--bs-muted)',
            background: 'var(--bs-soft)',
            borderRadius: 12,
            padding: '10px 14px',
            lineHeight: 1.45,
          }}
        >
          {msg}
        </p>
      ) : null}
      {showPoweredBy ? (
        <p style={{ marginTop: 18, fontSize: 11, color: 'var(--bs-faint)', textAlign: 'center', letterSpacing: '0.02em' }}>
          Powered by Bagseven
        </p>
      ) : null}
    </div>
  );

  if (mode === 'modal') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15,23,42,0.48)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 50,
          padding: 16,
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 20,
            padding: 24,
            width: 'min(720px, 100%)',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 24px 48px rgba(15,23,42,0.18)',
          }}
        >
          {body}
        </div>
      </div>
    );
  }
  return body;
}
