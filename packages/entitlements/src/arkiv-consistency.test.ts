import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], patch: vi.fn() }));
vi.mock('@arkiv-network/sdk', () => ({
  createPublicClient: () => ({ select: () => ({ from: () => ({ where: () => ({ fetch: async () => ({ entities: rpc.rows }) }) }) }), getEntity: async () => rpc.rows[0] }),
  createWalletClient: () => ({ patchEntity: rpc.patch }), ExpirationTime: { fromSeconds: (value: number) => value },
}));
import { ArkivGrantStore } from './arkiv-store.js';
const key = `0x${'1'.repeat(64)}` as const;
function row(remaining = '3', updated = '2026-01-01T00:00:00.000Z') {
  return { $key: key, grant_id: 'grant-a', holder: 'customer', feature: 'ocr', enabled: 'true', remaining, renewal_enabled: 'true', paid_through: '2099-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', updated_at: updated, settlement_network: 'local' };
}
const store = () => new ArkivGrantStore({ accessKey: 'test', privateKey: key, providerFunded: false });
beforeEach(() => { rpc.rows = [row()]; rpc.patch.mockReset().mockResolvedValue({}); });
describe('Arkiv read-after-write consistency', () => {
  it('does not let an old indexed row restore credits after a successful consume', async () => {
    const grants = store(); await grants.findLive({holder:'customer'});
    expect((await grants.consume('grant-a','1','usage-a')).remaining).toBe('2');
    expect((await grants.findLive({holder:'customer'}))[0].remaining).toBe('2');
    expect((await grants.get('grant-a'))?.remaining).toBe('2');
  });
  it('does not resurrect an exhausted grant from a stale positive index row', async () => {
    rpc.rows = [row('1')]; const grants = store(); await grants.findLive({holder:'customer'});
    await grants.consume('grant-a','1','last-credit');
    expect(await grants.findLive({holder:'customer'})).toEqual([]);
  });
  it('does not restore renewal after cancellation when the index is behind', async () => {
    const grants = store(); await grants.findLive({holder:'customer'}); await grants.cancelRenewal('grant-a');
    expect((await grants.findLive({holder:'customer'}))[0].renewal_enabled).toBe(false);
  });
  it('invalidates a cached positive grant when another client exhausts it', async () => {
    const grants = store(); await grants.findLive({holder:'customer'});
    rpc.rows = [row('0', '2026-01-02T00:00:00.000Z')];
    expect(await grants.findLive({holder:'customer'})).toEqual([]);
  });
  it('serializes simultaneous burns against the same grant', async () => {
    const grants = store(); await grants.findLive({holder:'customer'});
    await Promise.all([grants.consume('grant-a','1','a'),grants.consume('grant-a','1','b')]);
    expect((await grants.get('grant-a'))?.remaining).toBe('1');
  });
});
