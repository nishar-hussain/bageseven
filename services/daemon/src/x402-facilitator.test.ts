import { describe, expect, it, vi } from 'vitest';
import { StandardV2Facilitator } from './x402-facilitator.js';
import type { PaymentPayload } from '@x402/core/types';
import type { X402Requirements } from './x402.js';
const requirement = { x402Version: 2, network: 'eip155:43113', scheme: 'exact', asset: `0x${'11'.repeat(20)}`,
  amount: '1', payTo: `0x${'22'.repeat(20)}`, maxTimeoutSeconds: 60 } as X402Requirements;
describe('versioned x402 facilitator adapter', () => {
  it('uses the verified standard v2 envelope and refuses advertised wrong networks', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.body) return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:43114' }] });
      expect(JSON.parse(String(init.body))).toMatchObject({ x402Version: 2, paymentRequirements: requirement });
      return Response.json({ isValid: true });
    });
    const adapter = new StandardV2Facilitator('https://facilitator.payai.network', fetcher);
    expect(await adapter.supports(requirement)).toBe(false);
    await adapter.verify({ x402Version: 2 } as PaymentPayload, requirement);
  });
  it('never treats HTTP success without settlement evidence as paid', async () => {
    const adapter = new StandardV2Facilitator('https://facilitator.payai.network', async () => Response.json({ success: true }));
    await expect(adapter.settle({ x402Version: 2 } as PaymentPayload, requirement)).rejects.toThrow('UNCONFIRMED');
  });
});
