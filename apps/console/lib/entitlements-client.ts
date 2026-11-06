/** Browser client — talks to Next BFF only (never daemon directly). */

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/daemon/${path.replace(/^\//, '')}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
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
    world: {
      enabled: boolean;
      mode: string;
      mock_proofs: boolean;
      idkit?: boolean;
      agent_pass?: boolean;
      app_id?: string | null;
      rp_id?: string | null;
      action?: string;
      environment?: 'production' | 'staging';
      oidc_client_id?: string | null;
    };
    whitechain: {
      pay_to?: string | null;
      usdt?: string;
      network: string;
      chain_id: number;
      explorer: string;
      operator: boolean;
      demo_settle: boolean;
    };
    arkiv: { live: boolean; store: string };
  };
  dual_gate: {
    require_grant: boolean;
    feature: string;
    features?: Array<{ id: string; label: string; actions: string[] }>;
    fetch_feature?: string;
  };
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

export type FeatureValueType = 'boolean' | 'numeric';

export type FeatureDef = {
  id: string;
  label: string;
  blurb: string;
  value_type: FeatureValueType;
  actions: string[];
  builtin: boolean;
  created_at?: string;
};

export const entitlementsApi = {
  status: () => api<MumbaiStatus>('GET', 'mumbai/status'),
  features: () => api<{ features: FeatureDef[] }>('GET', 'features'),
  createFeature: (body: {
    id: string;
    label?: string;
    blurb?: string;
    value_type?: FeatureValueType;
    actions?: string[];
  }) => api<{ feature: FeatureDef }>('POST', 'features', body),
  live: (q?: { holder?: string; feature?: string }) => {
    const params = new URLSearchParams();
    if (q?.holder) params.set('holder', q.holder);
    if (q?.feature) params.set('feature', q.feature);
    const qs = params.toString();
    return api<{
      grants: Grant[];
      store?: { mode?: string; live?: boolean; rpcUrl?: string };
      physics?: Record<string, string>;
      features?: string[];
    }>('GET', `grants/live${qs ? `?${qs}` : ''}`);
  },
  mint: (body: Record<string, unknown>) => api<{ grant: Grant; settlement?: { payment_tx?: string; explorer_url?: string; mode?: string }; world?: { mode?: string } }>('POST', 'grants/mint', body),
  buyCredits: (body: Record<string, unknown>) => api<{ grant: Grant; settlement?: { payment_tx?: string; explorer_url?: string; mode?: string } }>('POST', 'grants/buy-credits', body),
  paidRun: (body: Record<string, unknown>) => api<{ grant: Grant; dual_gate?: unknown }>('POST', 'grants/paid-run', body),
  cancelRenewal: (id: string) => api<{ grant: Grant }>('POST', `grants/${encodeURIComponent(id)}/cancel-renewal`),
  explainDenial: (body: Record<string, unknown>) => api<{ denied: boolean; reasons: Array<{ code: string; detail: string }> }>('POST', 'grants/explain-denial', body),
  worldAuthorize: (redirectUri?: string) => {
    const qs = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return api<{
      mode: string;
      authorize_url?: string | null;
      state?: string;
      note?: string;
      mock?: boolean;
    }>('GET', `world/authorize${qs}`);
  },
  worldCallback: (body: { code: string; state: string; redirect_uri?: string; iss?: string }) =>
    api<{
      ok: boolean;
      id_token: string;
      human_id: string;
      world_proof_id: string;
      mode: string;
    }>('POST', 'world/callback', body),
  worldRpSignature: (action?: string) =>
    api<{
      sig: string;
      nonce: string;
      created_at: number;
      expires_at: number;
      action: string;
      rp_id: string | null;
      app_id: string | null;
    }>('POST', 'world/rp-signature', { action }),
  worldVerifyIdkit: (idkit_response: unknown, action?: string) =>
    api<{
      ok: boolean;
      human_id: string;
      world_proof_id: string;
      nullifier: string;
      action: string;
      mode: string;
    }>('POST', 'world/verify-idkit', { idkit_response, action }),
};
