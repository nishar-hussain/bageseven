import type { PaymentPayload } from '@x402/core/types';
import type { Hex } from 'viem';
import type { X402Requirements } from './x402.js';

export interface X402Facilitator {
  readonly url: string;
  supports(requirement: X402Requirements): Promise<boolean>;
  verify(payload: PaymentPayload, requirement: X402Requirements): Promise<void>;
  settle(payload: PaymentPayload, requirement: X402Requirements): Promise<{ transaction: Hex; network: string }>;
}

/** Standard x402 v2 envelope, verified against PayAI's public capability and verify endpoints. */
export class StandardV2Facilitator implements X402Facilitator {
  readonly url: string;
  constructor(url: string, private fetcher: typeof fetch = fetch, allowLocal = false) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw Error('X402_FACILITATOR_ORIGIN_REQUIRED');
    if (parsed.protocol !== 'https:' && !(allowLocal && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw Error('X402_FACILITATOR_HTTPS_REQUIRED');
    this.url = parsed.origin;
  }
  private async request(path: string, body?: unknown) {
    const response = await this.fetcher(`${this.url}${path}`, { method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), redirect: 'error' });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !data) throw Error(`X402_FACILITATOR_UNAVAILABLE: ${response.status}`);
    return data;
  }
  async supports(requirement: X402Requirements) {
    const data = await this.request('/supported');
    const kinds = data.kinds as Array<{ x402Version: number; network: string; scheme: string }> | undefined;
    return Boolean(kinds?.some(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === requirement.network));
  }
  private envelope(paymentPayload: PaymentPayload, paymentRequirements: X402Requirements) {
    return { x402Version: 2, paymentPayload, paymentRequirements };
  }
  async verify(payload: PaymentPayload, requirement: X402Requirements) {
    const data = await this.request('/verify', this.envelope(payload, requirement));
    if (data.isValid !== true) throw Error(`X402_AUTHORIZATION_REFUSED: ${String(data.invalidReason || 'verification failed')}`);
  }
  async settle(payload: PaymentPayload, requirement: X402Requirements) {
    const data = await this.request('/settle', this.envelope(payload, requirement));
    if (data.success !== true || typeof data.transaction !== 'string' || !/^0x[\da-f]{64}$/i.test(data.transaction) || data.network !== requirement.network) {
      throw Error('X402_SETTLEMENT_UNCONFIRMED: reconcile authorization on-chain before retry or refund');
    }
    return { transaction: data.transaction as Hex, network: data.network as string };
  }
}
