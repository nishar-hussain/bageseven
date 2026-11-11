import { describe, expect, it, vi } from 'vitest';
import { scopedDaemon, principalKey } from './mcp-principal';
const principal = { humanId: 'alice@example.com', accountWallet: `0x${'11'.repeat(20)}`, clientId: 'client' };
describe('MCP account isolation', () => {
  it('scopes grant discovery and rejects another holder', async () => {
    const call = vi.fn(async () => ({}));
    const scoped = scopedDaemon(principal, call);
    await scoped('GET', '/internal/grants/live?feature=ocr');
    expect(call.mock.calls[0]?.[1]).toContain('holder=alice%40example.com');
    await expect(scoped('GET', '/internal/grants/live?holder=bob@example.com')).rejects.toThrow('HOLDER_MISMATCH');
  });
  it('passes authenticated actor scope for prepaid writes', async () => {
    const call = vi.fn(async () => ({}));
    await scopedDaemon(principal, call)('POST', '/internal/grants/paid-run', { amount: '1' });
    expect(call.mock.calls[0]?.[3]).toMatchObject({ 'x-bagseven-actor': principal.humanId });
  });
  it('refuses another wallet’s spending worker before forwarding a payment', async () => {
    const call = vi.fn(async () => ({ mandate: { owner_address: `0x${'22'.repeat(20)}` } }));
    await expect(scopedDaemon(principal, call)('POST', '/internal/workers/worker/fetch', {})).rejects.toThrow('WORKER_OWNER_MISMATCH');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('does not reveal another customer subscription', async () => {
    const call = vi.fn(async () => ({ subscription: { holder: 'bob@example.com' } }));
    await expect(scopedDaemon(principal, call)('GET', '/v1/subscriptions/sub_other')).rejects.toThrow('HOLDER_MISMATCH');
  });
  it('binds session identity to the account, wallet and OAuth client', () => {
    expect(principalKey(principal)).not.toBe(principalKey({ ...principal, humanId: 'bob@example.com' }));
    expect(principalKey(principal)).not.toBe(principalKey({ ...principal, clientId: 'other-client' }));
  });
});
