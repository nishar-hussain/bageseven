import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ArkivGrantStore } from './arkiv-store.js';
import { configureProviderGrantSigners } from './provider-signers.js';
const rpc = vi.hoisted(() => ({ create: vi.fn(), patch: vi.fn(), wallet: vi.fn() }));
vi.mock('@arkiv-network/sdk', async original => ({ ...await original<typeof import('@arkiv-network/sdk')>(),
  createPublicClient: () => ({}), createWalletClient: (config: { account: unknown }) => { rpc.wallet(config); return { account: config.account, createEntity: rpc.create, patchEntity: rpc.patch }; },
}));
describe('provider-funded Arkiv writes', () => {
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
