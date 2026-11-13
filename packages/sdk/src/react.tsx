'use client';
export { WalletOperationBoundary } from './wallet-notice.js';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { sumCredits } from './credits.js';
import type { Entitlement } from './types.js';

export { EMBED_COMPONENTS, resolveEmbedComponent, type EmbedComponentId } from './components.js';
export { BagsevenEmbed, type EmbedTheme, type EmbedView } from './embed.js';

type BagsevenContextValue = {
  publishableKey: string;
  apiUrl: string;
  holder: string | null;
  accessToken: string | null;
  identify: (input: { holder: string }) => void;
  refresh: () => Promise<void>;
  entitlements: Entitlement[];
  pending: boolean;
  error: string | null;
  /** Apply a confirmed server-side consume result before refreshing query data. */
  applyEntitlement: (entitlement: Entitlement) => void;
};

const BagsevenContext = createContext<BagsevenContextValue | null>(null);

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

export function BagsevenProvider({
  publishableKey,
  apiUrl = '/api/public',
  accessToken,
  holder: holderProp,
  children,
}: {
  publishableKey: string;
  apiUrl?: string;
  accessToken?: string;
  /** Optional — prefer this over calling identify() so the first refresh has a holder. */
  holder?: string;
  children: ReactNode;
}) {
  const [holder, setHolder] = useState<string | null>(holderProp ?? null);
  const [token, setToken] = useState<string | null>(accessToken ?? null);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const confirmed = useRef(new Map<string, Entitlement>());

  useEffect(() => {
    if (accessToken) setToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (holderProp) setHolder(holderProp);
  }, [holderProp]);

  const auth = token || publishableKey;
  const base = apiUrl.replace(/\/$/, '');

  const applyEntitlement = useCallback((entitlement: Entitlement) => {
    confirmed.current.set(entitlement.grant_id ?? entitlement.feature, entitlement);
    setEntitlements(previous => [...previous.filter(e => (e.grant_id ?? e.feature) !== (entitlement.grant_id ?? entitlement.feature)), entitlement]);
  }, []);

  const refresh = useCallback(async () => {
    if (!auth || !holder) return;
    const request = ++generation.current;
    setPending(true);
    try {
      const qs = new URLSearchParams({ holder });
      const data = await publicGet<{ entitlements: Entitlement[] }>(base, `/entitlements?${qs}`, auth);
      if (request !== generation.current) return;
      const byGrant = new Map((data.entitlements ?? []).map(e => [e.grant_id ?? e.feature, e]));
      for (const [key, local] of confirmed.current) {
        if (local.paid_through && Date.parse(local.paid_through) <= Date.now()) {
          confirmed.current.delete(key);
          continue;
        }
        const remote = byGrant.get(key);
        const caughtUp = remote && (
          (remote.updated_at && local.updated_at && Date.parse(remote.updated_at) >= Date.parse(local.updated_at)) ||
          (!remote.updated_at && remote.remaining === local.remaining && remote.enabled === local.enabled));
        if (caughtUp) confirmed.current.delete(key);
        else byGrant.set(key, local);
      }
      setEntitlements([...byGrant.values()]);
      setError(null);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      if (request === generation.current) setPending(false);
    }
  }, [auth, holder, base]);

  useEffect(() => {
    const requests = generation;
    confirmed.current.clear();
    setEntitlements([]);
    setError(null);
    void refresh().catch(() => {});
    return () => { requests.current++; };
  }, [refresh]);

  const identify = useCallback((input: { holder: string }) => {
    setHolder(input.holder);
  }, []);

  const value = useMemo(
    () => ({ publishableKey, apiUrl: base, holder, accessToken: token, identify, refresh, entitlements, pending, error, applyEntitlement }),
    [publishableKey, base, holder, token, identify, refresh, entitlements, pending, error, applyEntitlement],
  );

  return <BagsevenContext.Provider value={value}>{children}</BagsevenContext.Provider>;
}

export function useBagseven(): BagsevenContextValue {
  const ctx = useContext(BagsevenContext);
  if (!ctx) throw new Error('useBagseven must be used inside BagsevenProvider');
  return ctx;
}

export function useFlag(feature: string): boolean {
  const { entitlements, error } = useBagseven();
  return !error && entitlements.some((e) => e.feature === feature && e.enabled);
}

export function useEntitlement(feature: string): Entitlement {
  const { entitlements, error } = useBagseven();
  const entitlement = entitlements.filter(e => e.feature === feature).sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.remaining) - Number(a.remaining))[0];
  if (entitlement) return error ? { ...entitlement, enabled: false, value: false } : entitlement;
  return ( {
      feature,
      enabled: false,
      value_type: 'numeric',
      remaining: '0',
      allocation: '0',
      paid_through: null,
      grant_id: null,
      value: false,
    }
  );
}

/** Total usable credits across this holder's living grants; booleans return 1/0. */
export function useRemaining(feature: string): string {
  const { entitlements, error } = useBagseven();
  if (error) return '0';
  const live = entitlements.filter(e => e.feature === feature && e.enabled &&
    (!e.paid_through || Date.parse(e.paid_through) > Date.now()));
  if (live.some(e => e.value_type === 'boolean')) return '1';
  return sumCredits(live.map(e => e.remaining));
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
      ctx.applyEntitlement(r.entitlement);
      // Usage succeeded even if the follow-up query is unavailable. The context
      // exposes that refresh error without reporting a failed/uncharged operation.
      await ctx.refresh().catch(() => {});
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
