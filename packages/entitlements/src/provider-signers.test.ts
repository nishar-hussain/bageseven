import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ArkivGrantStore } from './arkiv-store.js';
import { configureProviderGrantSigners } from './provider-signers.js';
import { str } from '@arkiv-network/sdk/schema';
const rpc = vi.hoisted(() => ({ create: vi.fn(), patch: vi.fn(), wallet: vi.fn(), rows: [] as Record<string, unknown>[] }));
vi.mock('@arkiv-network/sdk', async original => ({ ...await original<typeof import('@arkiv-network/sdk')>(),
  createPublicClient: () => ({ select: () => ({ from: () => ({ where: () => ({ fetch: async () => ({ entities: rpc.rows }) }) }) }) }), createWalletClient: (config: { account: unknown }) => { rpc.wallet(config); return { account: config.account, createEntity: rpc.create, patchEntity: rpc.patch }; },
}));
describe('provider-funded Arkiv writes', () => {
  it('round trips long holder and provider identities through the real string validator after restart', async () => {
    const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
    const resolve = vi.fn(async () => account);
    configureProviderGrantSigners(resolve);
    rpc.create.mockImplementationOnce(async (_schema, values) => {
      for (const value of Object.values(values)) if (typeof value === 'string') str(value);
      rpc.rows = [{ ...values, $key: `0x${'cd'.repeat(32)}`, $owner: account.address }];
      return { entityKey: `0x${'cd'.repeat(32)}` };
    });
    const input = { holder: `world:${'a'.repeat(150)}`, merchant: `world:${'b'.repeat(150)}`, human_id: 'h'.repeat(150), world_proof_id: 'p'.repeat(150), feature: 'ocr', remaining: '50', ttl_seconds: 86400, renewal_enabled: false, settlement_network: 'whitechain' as const };
    const store = ArkivGrantStore.fromEnv({ ARKIV_ACCESS_KEY: 'test' });
    const minted = await store.mint(input);
    const restarted = ArkivGrantStore.fromEnv({ ARKIV_ACCESS_KEY: 'test' });
    const grants = await restarted.findLive({ holder: input.holder });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ id: minted.id, holder: input.holder, merchant: input.merchant, human_id: input.human_id, world_proof_id: input.world_proof_id, remaining: '50' });
    await restarted.consume(minted.id, '1', 'long-holder-use');
    expect(resolve).toHaveBeenLastCalledWith(input.merchant);
  });
  it('routes creation and every credit update to the owning provider, never the configured platform key', async () => {
    const one = privateKeyToAccount(`0x${'01'.repeat(32)}`); const two = privateKeyToAccount(`0x${'02'.repeat(32)}`);
    const resolve = vi.fn(async (provider: string) => provider === 'one' ? one : two);
    configureProviderGrantSigners(resolve);
    rpc.create.mockResolvedValue({ entityKey: `0x${'ab'.repeat(32)}` }); rpc.patch.mockResolvedValue({});
    const store = ArkivGrantStore.fromEnv({ ARKIV_ACCESS_KEY: 'test', ARKIV_PRIVATE_KEY: 'unused-platform-key' });
    const grant = await store.mint({ merchant: 'one', holder: 'customer', feature: 'ocr', remaining: '3', ttl_seconds: 120, settlement_network: 'whitechain' });
    await store.consume(grant.id, '1', 'job'); await store.cancelRenewal(grant.id);
    await store.mint({ merchant: 'two', holder: 'customer-two', feature: 'ocr', remaining: '1', ttl_seconds: 120, settlement_network: 'whitechain' });
    expect(resolve.mock.calls.map(c => c[0])).toEqual(['one', 'one', 'one', 'two']);
    expect(rpc.wallet.mock.calls.map(c => c[0].account.address)).toEqual([one.address, one.address, one.address, two.address]);
  });
  it('refuses unbound legacy grants instead of using the platform key', async () => {
    const store = ArkivGrantStore.fromEnv({ ARKIV_ACCESS_KEY: 'test', ARKIV_PRIVATE_KEY: `0x${'01'.repeat(32)}` });
    await expect(store.mint({ holder: 'legacy', feature: 'ocr', remaining: '1', ttl_seconds: 120, settlement_network: 'whitechain' })).rejects.toThrow('PROVIDER_GAS_REQUIRED');
  });
});
