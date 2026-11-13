import { describe, expect, it } from 'vitest';
import { assertLocalConfiguration } from './local-config.mjs';
const ready = {
  DEV_MODE: 'true',
  AVALANCHE_NETWORK: 'fuji',
  CHAIN_ID: '43113',
  ENTITLEMENT_STORE: 'avalanche',
  AVALANCHE_ENTITLEMENT_REGISTRY: `0x${'33'.repeat(20)}`,
  AVALANCHE_USDC: `0x${'44'.repeat(20)}`,
  ENTITLEMENT_SUBJECT_SECRET: 'ab'.repeat(32),
  AVALANCHE_RPC_URL: 'http://localhost:8545',
};
describe('local startup preflight', () => {
  it('accepts explicit Avalanche configuration', () =>
    expect(() => assertLocalConfiguration(ready)).not.toThrow());
  it('refuses Anvil aliases when the public runtime is selected', () => {
    expect(() => assertLocalConfiguration({ ...ready, DEV_MODE: 'false' })).toThrow('public HTTPS');
  });
  it('rejects mismatched chain IDs before starting a partial stack', () => {
    expect(() => assertLocalConfiguration({ ...ready, CHAIN_ID: '1' })).toThrow('No services were started');
  });
  it('rejects missing contracts without exposing credentials or falling back to memory', () => {
    try {
      assertLocalConfiguration({
        ...ready,
        AVALANCHE_ENTITLEMENT_REGISTRY: '',
        AVALANCHE_RPC_URL: 'https://private:credential@rpc.example',
      });
    } catch (error) {
      expect(String(error)).toContain('AVALANCHE_ENTITLEMENT_REGISTRY');
      expect(String(error)).not.toContain('credential');
      return;
    }
    throw Error('Expected invalid configuration to be rejected');
  });
  it('rejects the memory store in production', () => {
    expect(() =>
      assertLocalConfiguration({ ...ready, NODE_ENV: 'production', ENTITLEMENT_STORE: 'memory' }),
    ).toThrow('Production requires');
  });
});
