import { randomUUID } from 'node:crypto';

/** Real public chain, local existing web/service ports. Never import Anvil authority. */
export function publicFujiRuntime(current, live, network, registry, databaseUrl, redisUrl, dataDir) {
  if (!/^0x[\da-f]{40}$/i.test(registry ?? '')) throw Error('A verified public Fuji registry is required');
  // Live templates are the allowlist; never carry unrelated old chain/key aliases.
  const values = { ...live };
  for (const key of [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  ]) {
    if ((!values[key] || values[key].includes('REPLACE_')) && current[key]) values[key] = current[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (
      /^(ANVIL|LOCAL_|DEMO_|WORLD_|ARKIV_|WHITECHAIN_|HEDERA_)/.test(key) ||
      [
        'DAEMON_OWNER_KEY',
        'DAEMON_EXECUTOR_KEY',
        'OWNER_DEV_KEY',
        'OPERATOR_DEV_KEY',
        'ENFORCER_DEV_KEY',
        'AVALANCHE_PRIVATE_KEY',
        'BAGSEVEN_PROVIDER_KEYS',
        'BAGSEVEN_X402_PAYER_KEY',
        'AVALANCHE_REGISTRY_PRIVATE_KEY',
        'MANDATE_DEPLOYER_KEY',
        'MCP_AUTH_TOKEN',
        'PRIVATE_KEY',
        'MNEMONIC',
        'DAEMON_OWNER_ADDRESS',
        'DAEMON_EXECUTOR_ADDRESS',
        'OPERATOR_WALLET',
        'AVALANCHE_PAY_TO',
        'PORT',
      ].includes(key) ||
      String(value).includes('REPLACE_') ||
      String(value).includes('${{')
    )
      delete values[key];
  }
  if (!/^0x[\da-f]{64}$/i.test(live.DAEMON_OPERATOR_KEY ?? ''))
    throw Error('Prepare the public Fuji intent signer first');
  Object.assign(values, {
    NODE_ENV: 'development',
    DEV_MODE: 'false',
    SIGNER_MODE: 'live',
    AVALANCHE_NETWORK: 'fuji',
    AVALANCHE_CHAIN_ID: '43113',
    CHAIN_ID: '43113',
    AVALANCHE_RPC_URL: network.rpcUrl,
    RPC_URL: network.rpcUrl,
    RPC_FALLBACK_URL: '',
    AVALANCHE_USDC: network.token,
    USDC_ADDRESS: network.token,
    AVALANCHE_ENTITLEMENT_REGISTRY: registry,
    AVALANCHE_DEMO_SETTLE: 'false',
    AVALANCHE_CONFIRMATIONS: '2',
    ENTITLEMENT_STORE: 'avalanche',
    PROVIDER_FUNDED_GAS: 'true',
    BAGSEVEN_REQUIRE_GRANT: 'true',
    GATEWAY_ALLOW_UNAUTHENTICATED: 'false',
    DATABASE_URL: databaseUrl,
    CONSOLE_DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    ENTITLEMENT_SUBJECT_SECRET: current.ENTITLEMENT_SUBJECT_SECRET || live.ENTITLEMENT_SUBJECT_SECRET,
    DAEMON_URL: 'http://localhost:4001',
    GATEWAY_URL: 'http://localhost:4000',
    POLICY_URL: 'http://localhost:4003',
    NEXT_PUBLIC_CONSOLE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_LANDING_URL: 'http://localhost:3001',
    NEXT_PUBLIC_BAGSEVEN_API_URL: 'http://localhost:3000/api/public',
    NEXT_PUBLIC_AVALANCHE_CHAIN_ID: '43113',
    NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL: network.rpcUrl,
    NEXT_PUBLIC_AVALANCHE_RPC_URL: network.rpcUrl,
    NEXT_PUBLIC_AVALANCHE_USDC: network.token,
    NEXT_PUBLIC_AVALANCHE_EXPLORER: 'https://testnet.snowtrace.io',
    NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY: live.BAGSEVEN_PUBLISHABLE_KEY,
    GATEWAY_AUTH_TOKEN: live.POLICY_INTERNAL_TOKEN,
    BAGSEVEN_DATA_DIR: dataDir,
    MCP_OAUTH_REQUIRED: 'true',
    BAGSEVEN_MCP_EMBEDDED: 'false',
    BAGSEVEN_MCP_PORT: '4009',
    BAGSEVEN_MCP_WORKER: live.BAGSEVEN_MCP_WORKER || randomUUID(),
  });
  if (/^https:\/\//.test(current.BAGSEVEN_MCP_PUBLIC_URL ?? ''))
    values.BAGSEVEN_MCP_PUBLIC_URL = current.BAGSEVEN_MCP_PUBLIC_URL;
  for (const key of [
    'AUTH_SECRET',
    'DAEMON_AUTH_TOKEN',
    'POLICY_INTERNAL_TOKEN',
    'PROVIDER_GAS_ENCRYPTION_KEY',
    'PROVIDER_SCOPE_SIGNING_KEY',
    'X402_PAYMENT_ENCRYPTION_KEY',
    'ENTITLEMENT_SUBJECT_SECRET',
    'BAGSEVEN_SECRET_KEY',
  ]) {
    if (!values[key] || values[key].length < 24) throw Error(`${key} must be prepared before activation`);
  }
  return values;
}
