/** Browser client for mandate/policy BFF (gateway → policy). */

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api/policy/${path.replace(/^\//, '')}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } })?.error;
    throw new Error(err?.message || err?.code || `Request failed (${res.status})`);
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
  list: (scope: 'all' | 'owner' = 'all', owner?: string) => {
    const q = new URLSearchParams({ scope });
    if (owner) q.set('owner_address', owner);
    return api<{ mandates: MandateSummary[] }>(`mandates?${q}`);
  },
  overview: (id: string) => api<MandateOverview>(`mandates/${encodeURIComponent(id)}/overview`),
};
