import { describe, it, expect } from 'vitest';
import { fujiProductionValues } from './fuji-config.mjs';

const network = { rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc', token: '0x5425890298aed601595a70AB815c96711a31Bc65' };
const template = { AUTH_SECRET: '', DAEMON_OPERATOR_KEY: '', ENTITLEMENT_SUBJECT_SECRET: '', PROVIDER_GAS_ENCRYPTION_KEY: '',
  ENTITLEMENT_STORE: 'avalanche', RESEND_API_KEY: '', NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: '', MANDATE_DEPLOYER_KEY: '' };
describe('public Fuji production configuration', () => {
  it('removes retired settings and never imports local financial authority or contract addresses', () => {
    const values = fujiProductionValues({ WORLD_APP_ID: 'old', ARKIV_PRIVATE_KEY: 'old', WHITECHAIN_RPC: 'old' },
      { DAEMON_OPERATOR_KEY: 'local-private-key', AVALANCHE_ENTITLEMENT_REGISTRY: 'local-registry', ENTITLEMENT_SUBJECT_SECRET: 'stable-secret' }, template, network);
    expect(values.ENTITLEMENT_STORE).toBe('avalanche');
    expect(values.AVALANCHE_ENTITLEMENT_REGISTRY).toBe('');
    expect(values.DAEMON_OPERATOR_KEY).not.toBe('local-private-key');
    expect(values.ENTITLEMENT_SUBJECT_SECRET).toBe('stable-secret');
    expect(values.WORLD_APP_ID).toBeUndefined(); expect(values.ARKIV_PRIVATE_KEY).toBeUndefined();
    expect(values.WHITECHAIN_RPC).toBeUndefined(); expect(values.MANDATE_DEPLOYER_KEY).toBeUndefined();
    expect(values.DEV_MODE).toBe('false'); expect(values.AVALANCHE_RPC_URL).toBe(network.rpcUrl);
  });
  it('preserves deployed keys and private subjects on repeated preparation', () => {
    const first = fujiProductionValues({}, {}, template, network, 'verified-registry');
    const second = fujiProductionValues(first, { ENTITLEMENT_SUBJECT_SECRET: 'different-local-secret' },
      Object.fromEntries(Object.keys(first).map(key => [key, ''])), network, 'verified-registry');
    for (const key of ['AUTH_SECRET', 'PROVIDER_GAS_ENCRYPTION_KEY', 'X402_PAYMENT_ENCRYPTION_KEY', 'DAEMON_OPERATOR_KEY', 'ENTITLEMENT_SUBJECT_SECRET']) expect(second[key]).toBe(first[key]);
    expect(second.X402_PAYMENT_ENCRYPTION_KEY).not.toBe(second.PROVIDER_GAS_ENCRYPTION_KEY);
  });
  it('replaces development authentication secrets and clears optional placeholder ownership restrictions', () => {
    const values = fujiProductionValues({ AUTH_SECRET: 'dev-auth-secret' }, {}, template, network);
    expect(values.AUTH_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(values.DAEMON_OWNER_ADDRESS).toBe('');
    expect(values.GATEWAY_AUTH_TOKEN).toBeUndefined();
  });
});
