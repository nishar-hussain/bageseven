import { describe, it, expect } from 'vitest';
import { publicFujiRuntime } from './fuji-runtime-config.mjs';
const network = { rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc', token: `0x${'11'.repeat(20)}` };
const live = Object.fromEntries(
  [
    'AUTH_SECRET',
    'DAEMON_AUTH_TOKEN',
    'POLICY_INTERNAL_TOKEN',
    'PROVIDER_GAS_ENCRYPTION_KEY',
    'PROVIDER_SCOPE_SIGNING_KEY',
    'X402_PAYMENT_ENCRYPTION_KEY',
    'ENTITLEMENT_SUBJECT_SECRET',
    'BAGSEVEN_SECRET_KEY',
  ].map((k) => [k, 'ab'.repeat(32)]),
);
Object.assign(live, {
  DAEMON_OPERATOR_KEY: `0x${'55'.repeat(32)}`,
  BAGSEVEN_PUBLISHABLE_KEY: 'pk_live_public',
  BAGSEVEN_MCP_WORKER: 'new-worker',
});
const prepare = (current = {}) =>
  publicFujiRuntime(
    current,
    live,
    network,
    `0x${'22'.repeat(20)}`,
    'postgres://local/bagseven_fuji',
    'redis://local/1',
    '/private/runtime',
  );
describe('Anvil to public Fuji activation', () => {
  it('removes development financial authority and mock aliases', () => {
    const v = prepare({
      DAEMON_OWNER_KEY: 'test-key',
      DAEMON_EXECUTOR_KEY: 'test-key',
      OWNER_DEV_KEY: 'test-key',
      LOCAL_MANDATE_ID: 'old',
      DEMO_HOLDER: 'old',
      MCP_AUTH_TOKEN: 'old',
      AVALANCHE_PRIVATE_KEY: 'old',
    });
    for (const key of [
      'DAEMON_OWNER_KEY',
      'DAEMON_EXECUTOR_KEY',
      'OWNER_DEV_KEY',
      'LOCAL_MANDATE_ID',
      'DEMO_HOLDER',
      'MCP_AUTH_TOKEN',
      'AVALANCHE_PRIVATE_KEY',
    ])
      expect(v[key]).toBeUndefined();
    expect(v.DEV_MODE).toBe('false');
    expect(v.AVALANCHE_DEMO_SETTLE).toBe('false');
    expect(v.PROVIDER_FUNDED_GAS).toBe('true');
    expect(v.DAEMON_OPERATOR_KEY).toBe(live.DAEMON_OPERATOR_KEY);
  });
  it('pins both browser and backend to public Fuji and keeps the existing app ports', () => {
    const v = prepare({
      AVALANCHE_RPC_URL: 'http://localhost:58545',
      NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL: 'http://localhost:58545',
    });
    expect(v.RPC_URL).toBe(network.rpcUrl);
    expect(v.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL).toBe(network.rpcUrl);
    expect(v.ENTITLEMENT_STORE).toBe('avalanche');
    expect(v.DAEMON_URL).toBe('http://localhost:4001');
    expect(v.NEXT_PUBLIC_CONSOLE_URL).toBe('http://localhost:3000');
    expect(v.DATABASE_URL).toContain('bagseven_fuji');
  });
  it('preserves the installation subject secret and a real HTTPS MCP endpoint', () => {
    const v = prepare({
      ENTITLEMENT_SUBJECT_SECRET: 'existing-stable-secret-'.repeat(3),
      BAGSEVEN_MCP_PUBLIC_URL: 'https://mcp.example',
    });
    expect(v.ENTITLEMENT_SUBJECT_SECRET).toBe('existing-stable-secret-'.repeat(3));
    expect(v.BAGSEVEN_MCP_PUBLIC_URL).toBe('https://mcp.example');
  });
  it('refuses activation without a verified registry', () => {
    expect(() => publicFujiRuntime({}, live, network, '', 'db', 'cache', 'data')).toThrow(
      'verified public Fuji registry',
    );
  });
});
