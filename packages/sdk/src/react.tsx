'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Entitlement } from './types.js';
import { connectWhitechainWallet, payUsdtOnWhitechain } from './wallet.js';

type BagsevenContextValue = {
  publishableKey: string;
  apiUrl: string;
  holder: string | null;
  accessToken: string | null;
  identify: (input: { holder: string }) => void;
  refresh: () => Promise<void>;
  entitlements: Entitlement[];
  pending: boolean;
};

const BagsevenContext = createContext<BagsevenContextValue | null>(null);

async function publicGet<T>(apiUrl: string, path: string, token: string): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
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

export function BagsevenProvider({
  publishableKey,
  apiUrl = '/api/public',
  accessToken,
  children,
}: {
  publishableKey: string;
  apiUrl?: string;
  accessToken?: string;
  children: ReactNode;
}) {
  const [holder, setHolder] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(accessToken ?? null);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (accessToken) setToken(accessToken);
  }, [accessToken]);

  const auth = token || publishableKey;
  const base = apiUrl.replace(/\/$/, '');

  const refresh = useCallback(async () => {
    if (!auth || !holder) return;
    setPending(true);
    try {
      const qs = new URLSearchParams({ holder });
      const data = await publicGet<{ entitlements: Entitlement[] }>(base, `/entitlements?${qs}`, auth);
      setEntitlements(data.entitlements ?? []);
    } finally {
      setPending(false);
    }
  }, [auth, holder, base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const identify = useCallback((input: { holder: string }) => {
    setHolder(input.holder);
  }, []);

  const value = useMemo(
    () => ({ publishableKey, apiUrl: base, holder, accessToken: token, identify, refresh, entitlements, pending }),
    [publishableKey, base, holder, token, identify, refresh, entitlements, pending],
  );

  return <BagsevenContext.Provider value={value}>{children}</BagsevenContext.Provider>;
}

export function useBagseven(): BagsevenContextValue {
  const ctx = useContext(BagsevenContext);
  if (!ctx) throw new Error('useBagseven must be used inside BagsevenProvider');
  return ctx;
}

export function useFlag(feature: string): boolean {
  const { entitlements, pending } = useBagseven();
  if (pending) return false;
  return entitlements.some((e) => e.feature === feature && e.enabled);
}

export function useEntitlement(feature: string): Entitlement {
  const { entitlements } = useBagseven();
  return (
    entitlements.find((e) => e.feature === feature) ?? {
      feature,
      enabled: false,
      remaining: '0',
      allocation: '0',
      paid_through: null,
      grant_id: null,
    }
  );
}

export function useConsumeEntitlement(): {
  consume: (feature: string, amount?: string) => Promise<Entitlement>;
} {
  const ctx = useBagseven();
  const consume = useCallback(
    async (feature: string, amount = '1') => {
      const token = ctx.accessToken ?? ctx.publishableKey;
      if (!ctx.holder) throw new Error('identify a holder before consume');
      const r = await publicPost<{ entitlement: Entitlement }>(ctx.apiUrl, '/usage/consume', token, {
        feature,
        holder: ctx.holder,
        amount,
        idempotencyKey: `ui-${feature}-${Date.now()}`,
      });
      await ctx.refresh();
      return r.entitlement;
    },
    [ctx],
  );
  return { consume };
}

export function FeatureFlagGuard({
  feature,
  children,
  fallback = null,
}: {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const enabled = useFlag(feature);
  return enabled ? <>{children}</> : <>{fallback}</>;
}

export type EmbedView = 'portal' | 'checkout' | 'consume' | 'credits' | 'unsubscribe';

type PublicCheckout = {
  id: string;
  status: string;
  amount: string;
  holder: string;
  plan: {
    id: string;
    name: string;
    feature: string;
    amount: string;
    credits: string;
    merchant_wallet: string;
  } | null;
};

export function BagsevenEmbed({
  accessToken,
  apiUrl = '/api/public',
  initialView = 'portal',
  mode = 'inline',
  publishableKey,
  checkoutSessionId,
}: {
  accessToken?: string;
  apiUrl?: string;
  initialView?: EmbedView;
  mode?: 'inline' | 'modal';
  publishableKey?: string;
  /** When set, checkout view loads this public session (no operator session needed). */
  checkoutSessionId?: string;
}) {
  const [view, setView] = useState<EmbedView>(checkoutSessionId ? 'checkout' : initialView);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [checkout, setCheckout] = useState<PublicCheckout | null>(null);
  const [demoTx, setDemoTx] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const base = apiUrl.replace(/\/$/, '');
  const token = accessToken ?? '';

  const load = useCallback(async () => {
    if (!token) return;
    const data = await publicGet<{ entitlements: Entitlement[] }>(base, '/entitlements', token);
    setEntitlements(data.entitlements ?? []);
  }, [token, base]);

  const loadCheckout = useCallback(async () => {
    if (!checkoutSessionId) return;
    const res = await fetch(`${base}/public/checkout/${encodeURIComponent(checkoutSessionId)}`);
    const json = (await res.json().catch(() => ({}))) as { session?: PublicCheckout; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `checkout ${res.status}`);
    setCheckout(json.session ?? null);
  }, [base, checkoutSessionId]);

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [load]);

  useEffect(() => {
    void loadCheckout().catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, [loadCheckout]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      await load();
      await loadCheckout();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs = (['portal', 'checkout', 'consume', 'credits', 'unsubscribe'] as EmbedView[]).filter(
    (v) => v !== 'checkout' || checkoutSessionId || view === 'checkout',
  );

  const body = (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#111', maxWidth: 480 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            style={{
              border: '1px solid #ddd',
              borderRadius: 999,
              padding: '6px 12px',
              background: view === v ? '#0002f8' : '#fff',
              color: view === v ? '#fff' : '#111',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {view === 'checkout' && (
        <div>
          <h3 style={{ margin: '0 0 8px' }}>Checkout</h3>
          {!checkoutSessionId && <p style={{ color: '#666', fontSize: 14 }}>Pass checkoutSessionId to BagsevenEmbed.</p>}
          {checkout && (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 14 }}>
                <strong>{checkout.plan?.name ?? 'Plan'}</strong> · {checkout.amount} USDT · {checkout.plan?.credits ?? '—'}{' '}
                credits · {checkout.status}
              </p>
              <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                Pay with WhiteWallet when available; MetaMask / injected EVM works on Whitechain Testnet (1874) today.
              </p>
              {checkout.status === 'PAID' ? (
                <p style={{ color: '#0a7', fontSize: 14 }}>Paid. Entitlement is live for {checkout.holder}.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    disabled={busy || !checkout.plan}
                    onClick={() =>
                      void act(async () => {
                        if (!checkout.plan) return;
                        const paid = await payUsdtOnWhitechain({
                          merchantWallet: checkout.plan.merchant_wallet,
                          amount: checkout.plan.amount,
                        });
                        await fetch(`${base}/public/checkout/${encodeURIComponent(checkout.id)}/confirm`, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify(paid),
                        }).then(async (r) => {
                          const j = await r.json().catch(() => ({}));
                          if (!r.ok) throw new Error(j.error?.message ?? `confirm ${r.status}`);
                        });
                        setMsg('Payment confirmed — grant minted');
                      })
                    }
                    style={{ borderRadius: 999, background: '#0002f8', color: '#fff', padding: '8px 14px', border: 0 }}
                  >
                    {busy ? 'Waiting for wallet…' : 'Pay with WhiteWallet / EVM'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const { address } = await connectWhitechainWallet();
                        setMsg(`Connected ${address}`);
                      })
                    }
                    style={{ borderRadius: 999, border: '1px solid #ddd', background: '#fff', padding: '8px 14px' }}
                  >
                    Connect wallet only
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={demoTx}
                      onChange={(e) => setDemoTx(e.target.value)}
                      placeholder="0x… payment_tx (demo)"
                      style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: '8px', fontSize: 12 }}
                    />
                    <button
                      type="button"
                      disabled={busy || !demoTx || !checkout.plan}
                      onClick={() =>
                        void act(async () => {
                          const { address } = await connectWhitechainWallet().catch(() => ({
                            address: '0x2222222222222222222222222222222222222222',
                          }));
                          await fetch(`${base}/public/checkout/${encodeURIComponent(checkout.id)}/confirm`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ payment_tx: demoTx.trim(), customer_wallet: address }),
                          }).then(async (r) => {
                            const j = await r.json().catch(() => ({}));
                            if (!r.ok) throw new Error(j.error?.message ?? `confirm ${r.status}`);
                          });
                          setMsg('Demo payment confirmed');
                        })
                      }
                      style={{ borderRadius: 999, border: '1px solid #ddd', padding: '8px 12px', fontSize: 12 }}
                    >
                      Confirm tx
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {view === 'portal' && (
        <div>
          <h3 style={{ margin: '0 0 8px' }}>Living entitlements</h3>
          {entitlements.length === 0 && <p style={{ color: '#666' }}>No living grant on Arkiv for this holder.</p>}
          {entitlements.map((e) => (
            <div key={e.grant_id ?? e.feature} style={{ borderTop: '1px solid #eee', padding: '10px 0' }}>
              <strong>{e.feature}</strong>
              <div style={{ fontSize: 13, color: '#555' }}>
                {e.remaining} credits · TTL {e.paid_through ?? '—'}
                {e.explorer_url ? (
                  <>
                    {' · '}
                    <a href={e.explorer_url} target="_blank" rel="noreferrer">
                      Whitechain
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {view === 'consume' && (
        <div>
          <p style={{ fontSize: 14, color: '#555' }}>Burn one credit on the richest living grant (human gate — grant only).</p>
          <button
            type="button"
            disabled={busy || entitlements.length === 0 || !token}
            onClick={() =>
              void act(async () => {
                const feature = entitlements[0]?.feature;
                if (!feature || !token) return;
                await publicPost(base, '/usage/consume', token, {
                  feature,
                  amount: '1',
                  idempotencyKey: `embed-${feature}-${Date.now()}`,
                });
                setMsg('Consumed 1 credit');
              })
            }
            style={{ borderRadius: 999, background: '#111', color: '#fff', padding: '8px 14px', border: 0 }}
          >
            {busy ? 'Working…' : 'Consume 1'}
          </button>
        </div>
      )}
      {view === 'credits' && (
        <div>
          <p style={{ fontSize: 14, color: '#555' }}>Whitechain top-up on this holder’s feature (not a payment link).</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const feature = entitlements[0]?.feature ?? 'ocr';
                if (!token) throw new Error('accessToken required for credits');
                await publicPost(base, '/credits', token, { feature, remaining: '10', amount: '1.00' });
                setMsg('Credits stamped on Whitechain');
              })
            }
            style={{ borderRadius: 999, background: '#0002f8', color: '#fff', padding: '8px 14px', border: 0 }}
          >
            {busy ? 'Settling…' : 'Buy 10 credits'}
          </button>
        </div>
      )}
      {view === 'unsubscribe' && (
        <p style={{ fontSize: 14, color: '#555' }}>
          Cancel renewal from the operator dashboard. Access stays until <code>paid_through</code> — renewal off does not kill the period already paid.
        </p>
      )}
      {msg && <p style={{ marginTop: 12, fontSize: 13, color: '#555' }}>{msg}</p>}
      {publishableKey ? <p style={{ marginTop: 16, fontSize: 11, color: '#999' }}>Bagseven embed</p> : null}
    </div>
  );

  if (mode === 'modal') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 'min(520px, 92vw)' }}>{body}</div>
      </div>
    );
  }
  return body;
}
