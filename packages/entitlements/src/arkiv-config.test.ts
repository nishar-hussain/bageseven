import { describe, expect, it } from 'vitest';
import { ArkivGrantStore, arkivTransportUrl } from './arkiv-store.js';

describe('live Arkiv configuration', () => {
  it('uses the configured access key instead of silently querying the rate-limited public RPC', () => {
    expect(arkivTransportUrl('https://rpc.rabdi.db-chain.testnet.arkiv.network', 'test/key')).toBe('https://rpc.rabdi.db-chain.testnet.arkiv.network/test%2Fkey');
    expect(arkivTransportUrl('https://rpc.rabdi.db-chain.testnet.arkiv.network/existing', 'key')).toBe('https://rpc.rabdi.db-chain.testnet.arkiv.network/existing');
    expect(arkivTransportUrl('https://custom.example/rpc', 'key')).toBe('https://custom.example/rpc');
  });
  it('refuses missing credentials instead of creating placeholder grants', () => {
    expect(() => ArkivGrantStore.fromEnv({ ENTITLEMENT_STORE: 'arkiv' })).toThrow('ARKIV_NOT_CONFIGURED');
    expect(() => new ArkivGrantStore('https://rpc.example.com')).toThrow('ARKIV_NOT_CONFIGURED');
    expect(() => ArkivGrantStore.fromEnv({ ARKIV_ACCESS_KEY: 'configured', ARKIV_PRIVATE_KEY: '0xinvalid', PROVIDER_FUNDED_GAS: 'false' })).toThrow('ARKIV_NOT_CONFIGURED');
  });
  it('does not require or use a platform private key for provider-funded live storage', () => {
    expect(() => ArkivGrantStore.fromEnv({ ARKIV_ACCESS_KEY: 'configured', ARKIV_PRIVATE_KEY: 'unused-invalid-platform-key' })).not.toThrow();
  });
});
