/** Browser client for thin Plans + Checkout Sessions (console BFF). */

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/billing/${path.replace(/^\//, '')}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    throw new Error(err?.message || err?.code || `Billing request failed (${res.status})`);
  }
  return json as T;
}

export type Plan = {
  id: string;
  feature: string;
  name: string;
  amount: string;
  interval: 'once' | 'month';
  credits: string;
  ttl_seconds: number;
  merchant_wallet: string;
  active: boolean;
};

export type CheckoutSession = {
  id: string;
  plan_id: string;
  holder: string;
  status: string;
  amount: string;
  payment_tx?: string;
  grant_id?: string;
  customer_wallet?: string;
  expires_at: string;
  plan?: Plan;
};

export const billingApi = {
  listPlans: () => api<{ plans: Plan[] }>('GET', 'plans'),
  createPlan: (body: Record<string, unknown>) => api<{ plan: Plan }>('POST', 'plans', body),
  listCheckouts: (q?: { holder?: string }) => {
    const params = new URLSearchParams();
    if (q?.holder) params.set('holder', q.holder);
    const qs = params.toString();
    return api<{ sessions: CheckoutSession[] }>('GET', `checkout-sessions${qs ? `?${qs}` : ''}`);
  },
  createCheckout: (body: Record<string, unknown>) =>
    api<{ session: CheckoutSession }>('POST', 'checkout-sessions', body),
};
