import type { ConsumeResult, Entitlement, IdentifyResult, Subscription } from './types.js';

export type { ConsumeResult, Entitlement, IdentifyResult, Subscription };

export class BagsevenApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BagsevenApiError';
  }
}

export class BagsevenClient {
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    if (!opts.apiKey) throw new Error('BagsevenClient requires apiKey');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:4001').replace(/\/$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    } & T;
    if (!res.ok) {
      throw new BagsevenApiError(res.status, json.error?.code ?? 'REQUEST_FAILED', json.error?.message ?? `Bagseven ${method} ${path} failed (${res.status})`);
    }
    return json as T;
  }

  /** Boolean-style flag check (ArcenPay / Schematic). Works for boolean and numeric features. */
  async checkFlag(feature: string, opts: { holder: string }): Promise<boolean> {
    const r = await this.checkEntitlement(feature, opts);
    return r.enabled;
  }

  /** Total living credits for the holder/feature. Boolean features return '1'/'0'. */
  async getRemaining(feature: string, opts: { holder: string }): Promise<string> {
    const r = await this.checkEntitlement(feature, opts);
    return r.total_remaining ?? r.remaining;
  }

  async checkEntitlement(feature: string, opts: { holder: string }): Promise<Entitlement> {
    const qs = new URLSearchParams({ feature, holder: opts.holder });
    return this.request<Entitlement>('GET', `/v1/check?${qs}`);
  }

  async listEntitlements(opts: { holder: string; feature?: string }): Promise<{ entitlements: Entitlement[] }> {
    const qs = new URLSearchParams({ holder: opts.holder });
    if (opts.feature) qs.set('feature', opts.feature);
    return this.request('GET', `/v1/entitlements?${qs}`);
  }

  async consumeEntitlement(input: {
    feature: string;
    holder: string;
    amount?: string;
    idempotencyKey?: string;
    grant_id?: string;
  }): Promise<ConsumeResult> {
    return this.request('POST', '/v1/usage/consume', input);
  }

  async identify(input: { holder: string; expiresIn?: number }): Promise<IdentifyResult> {
    return this.request('POST', '/v1/access-tokens', input);
  }

  async buyCredits(input: {
    feature: string;
    holder: string;
    remaining?: string;
    ttl_seconds?: number;
    amount?: string;
    payment_tx?: string;
  }): Promise<{ grant: unknown; entitlement: Entitlement; settlement: unknown }> {
    return this.request('POST', '/v1/credits', input);
  }

  async createPlan(input: {
    feature: string;
    name: string;
    amount: string;
    interval?: 'once' | 'month';
    credits?: string;
    ttl_seconds?: number;
    merchant_wallet: string;
  }): Promise<{ plan: unknown }> {
    return this.request('POST', '/v1/plans', input);
  }

  async listPlans(): Promise<{ plans: unknown[] }> {
    return this.request('GET', '/v1/plans');
  }

  async listSubscriptions(holder?: string): Promise<{ subscriptions: Subscription[] }> {
    return this.request('GET', `/v1/subscriptions${holder ? `?${new URLSearchParams({ holder })}` : ''}`);
  }

  async getSubscription(id: string): Promise<{ subscription: Subscription }> {
    return this.request('GET', `/v1/subscriptions/${encodeURIComponent(id)}`);
  }

  /** Prepare cancellation only. The payer must approve its transaction in their wallet. */
  async prepareSubscriptionCancellation(id: string): Promise<{
    requires_wallet_approval: true; payer: string; chain_id: number;
    transaction: { to: string; data: string; value: string };
  }> {
    return this.request('POST', `/v1/subscriptions/${encodeURIComponent(id)}/cancel`, {});
  }

  async syncSubscription(id: string): Promise<{ subscription: Subscription }> {
    return this.request('POST', `/v1/subscriptions/${encodeURIComponent(id)}/sync`, {});
  }

  async createCheckoutSession(input: {
    plan_id: string;
    holder: string;
    success_url?: string;
    expires_in?: number;
  }): Promise<{ session: { id: string; status: string; amount: string; holder: string } }> {
    return this.request('POST', '/v1/checkout-sessions', input);
  }

  async getCheckoutSession(id: string): Promise<{ session: unknown }> {
    return this.request('GET', `/v1/checkout-sessions/${encodeURIComponent(id)}`);
  }
}
