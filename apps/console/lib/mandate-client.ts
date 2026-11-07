import { errorMessage } from './error-message';
/** Browser client for mandate/policy BFF (gateway → policy). */

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/policy/${path.replace(/^\//, '')}`, { cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } })?.error;
    throw new Error(errorMessage(err, `Request failed (${res.status})`));
  }
  return json as T;
}

export type MandateSummary = {
  id: string;
  owner_address: string;
  operator_address: string;
  contract_address: string | null;
  budget_per_window: string;
  window_seconds: number;
  lifetime_cap: string;
  per_purchase_cap: string;
  per_seller_pct: number;
  max_depth: number;
  status: string;
  created_at?: string;
};

export type MandateOverview = {
  mandate_id: string;
  spent_this_window: string;
  budget_per_window: string;
  spent_total: string;
  lifetime_cap: string;
  vault_available: string;
  can_be_drawn_now: string;
  onchain_state: { status: 'available' } | { status: 'unavailable'; message: string };
  onchain_revoked: boolean | null;
  agents: Array<{
    id: string;
    operator_address: string;
    share_percent: string;
    depth: number;
    status: string;
    parent_agent_id?: string | null;
    name?: string | null;
    mcp_endpoint?: string | null;
  }>;
  recent_refusals: unknown[];
  terms: {
    owner_address: string;
    operator_address: string;
    window_seconds: number;
    per_purchase_cap: string;
    per_seller_pct: number;
    max_depth: number;
    contract_address?: string | null;
    status?: string;
  };
};

export const mandateApi = {
  config: () => api<SpendingConfig>('mandate-config'),
  prepare: (body: Record<string, unknown>) => api<PreparedPermission>('mandates/prepare', body),
  create: (body: Record<string, unknown>) => api<{ mandate_id: string; root_agent_id: string }>('mandates', body),
  delegate: (id: string, body: Record<string, unknown>) => api<PreparedPermission>(`mandates/${encodeURIComponent(id)}/delegation`, body),
  spawn: (id: string, body: Record<string, unknown>) => api<{ agent_id: string }>(`mandates/${encodeURIComponent(id)}/spawn-agent`, body),
  transaction: (id: string, body: Record<string, unknown>) => api<{ chain_id: number; from: string; to: string; data: string; value: string }>(`mandates/${encodeURIComponent(id)}/transaction`, body),
  /** BFF forces owner scope to the signed-in operator wallets — `scope=all` is rejected. */
  list: (scope: 'owner' | 'all' = 'owner', owner?: string) => {
    const q = new URLSearchParams({ scope: scope === 'all' ? 'owner' : 'owner' });
    if (owner) q.set('owner_address', owner);
    return api<{ mandates: MandateSummary[] }>(`mandates?${q}`);
  },
  overview: (id: string) => api<MandateOverview>(`mandates/${encodeURIComponent(id)}/overview`),
};

export type SpendingConfig = { chain_id: number; token: string; rpc_url: string; operator_address: string; owner_addresses: string[] };
type PreparedPermission = { message: string; payload: Record<string, unknown> };
