import { describe, expect, it } from 'vitest';
import { providerCheckoutBlockReason } from '../lib/provider-checkout';

const active = { configured: true, status: 'active', expires_at: '2030-01-01T00:00:00Z', balances: { registry: '0.01' } };
describe('provider checkout readiness', () => {
  it('requires provider authorization before offering a payment', () => {
    expect(providerCheckoutBlockReason({ configured: false })).toContain('Authorize');
    expect(providerCheckoutBlockReason({ ...active, status: 'revoked' })).toContain('revoked');
    expect(providerCheckoutBlockReason({ ...active, expires_at: '2000-01-01' })).toContain('expired');
  });
  it('blocks unknown or zero Registry gas balances', () => {
    expect(providerCheckoutBlockReason({ ...active, balances: { registry: null } })).toContain('could not be checked');
    expect(providerCheckoutBlockReason({ ...active, balances: { registry: '0' } })).toContain('AVAX');
  });
  it('does not require funding a platform wallet or provider Avalanche gas for human checkout', () => {
    expect(providerCheckoutBlockReason(active)).toBeNull();
  });
});
