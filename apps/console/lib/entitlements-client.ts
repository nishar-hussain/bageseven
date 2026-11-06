/** Browser client — talks to Next BFF only (never daemon directly). */

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/daemon/${path.replace(/^\//, '')}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    throw new Error(err?.message || err?.code || `Request failed (${res.status})`);
  }
  return json as T;
}

export type MumbaiStatus = {
  tracks: {
    world: { enabled: boolean; mode: string; mock_proofs: boolean };
    hedera: { network: string; facilitator: boolean; demo_settle: boolean; hcs_topic: string | null };
    arkiv: { live: boolean; store: string };
  };
  dual_gate: { require_grant: boolean; feature: string };
};

export type Grant = {
  id: string;
  feature: string;
  holder: string;
  remaining: string;
  renewal_enabled: boolean;
  paid_through: string;
  payment_tx?: string;
  settlement_network?: string;
  arkiv_entity_key?: string;
  world_proof_id?: string;
  human_id?: string;
};

export const entitlementsApi = {
  status: () => api<MumbaiStatus>('GET', 'mumbai/status'),
  live: (q?: { holder?: string; feature?: string }) => {
    const params = new URLSearchParams();
    if (q?.holder) params.set('holder', q.holder);
    if (q?.feature) params.set('feature', q.feature);
    const qs = params.toString();
    return api<{ grants: Grant[]; store?: unknown }>('GET', `grants/live${qs ? `?${qs}` : ''}`);
  },
  mint: (body: Record<string, unknown>) => api<{ grant: Grant; settlement?: { payment_tx?: string; hashscan_url?: string; mode?: string }; world?: { mode?: string } }>('POST', 'grants/mint', body),
  buyCredits: (body: Record<string, unknown>) => api<{ grant: Grant; settlement?: { payment_tx?: string; hashscan_url?: string; mode?: string } }>('POST', 'grants/buy-credits', body),
  paidRun: (body: Record<string, unknown>) => api<{ grant: Grant; dual_gate?: unknown }>('POST', 'grants/paid-run', body),
  cancelRenewal: (id: string) => api<{ grant: Grant }>('POST', `grants/${encodeURIComponent(id)}/cancel-renewal`),
  explainDenial: (body: Record<string, unknown>) => api<{ denied: boolean; reasons: Array<{ code: string; detail: string }> }>('POST', 'grants/explain-denial', body),
  worldAuthorize: () => api<{ mode: string; authorize_url?: string | null; note?: string }>('GET', 'world/authorize'),
};
