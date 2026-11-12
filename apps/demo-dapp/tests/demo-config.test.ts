import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { receiptPlanIds, internal } from '../demo-config.mjs';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('receipt app provider integration', () => {
  it('shows active provider plans after renaming and excludes other providers', () => {
    expect(receiptPlanIds([
      { id: 'starter', name: 'Receipt Starter', provider_id: 'provider', feature: 'ocr', active: true },
      { id: 'renamed', name: 'My custom plan', provider_id: 'provider', feature: 'pro_notes', active: true },
      { id: 'other', provider_id: 'other', feature: 'ocr', active: true },
      { id: 'retired', provider_id: 'provider', feature: 'ocr', active: false },
    ], 'provider')).toEqual(['starter', 'renamed']);
  });
  it('signs merchant requests with the dedicated scope key, not the custody key', async () => {
    vi.stubEnv('DEMO_PROVIDER_ID', 'provider'); vi.stubEnv('PROVIDER_SCOPE_SIGNING_KEY', 'scope-key');
    vi.stubEnv('PROVIDER_GAS_ENCRYPTION_KEY', 'custody-key');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ plans: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await internal('GET', '/v1/plans');
    const headers = fetcher.mock.calls[0][1].headers;
    const [payload, signature] = headers['x-bagseven-provider-scope'].split('.');
    expect(signature).toBe(createHmac('sha256', 'scope-key').update(`bagseven-provider-scope-v1:${payload}`).digest('base64url'));
  });
});
