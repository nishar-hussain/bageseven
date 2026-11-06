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

  useEffect(() => {
    if (accessToken) setToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (holderProp) setHolder(holderProp);
  }, [holderProp]);

  const auth = token || publishableKey;
  const base = apiUrl.replace(/\/$/, '');

  const refresh = useCallback(async () => {
    if (!auth || !holder) return;
    setPending(true);
    try {
      const qs = new URLSearchParams({ holder });
      const data = await publicGet<{ entitlements: Entitlement[] }>(base, `/entitlements?${qs}`, auth);
      setEntitlements(data.entitlements ?? []);
    } catch {
      // Keep prior entitlements; surface stays usable offline of a transient BFF blip.
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
  const { entitlements } = useBagseven();
  return entitlements.some((e) => e.feature === feature && e.enabled);
}

export function useEntitlement(feature: string): Entitlement {
  const { entitlements } = useBagseven();
  return (
    entitlements.find((e) => e.feature === feature) ?? {
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

/** Numeric credits remaining; boolean features surface `'1'` while live. */
export function useRemaining(feature: string): string {
  return useEntitlement(feature).remaining;
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
