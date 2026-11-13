import { randomBytes, randomUUID } from 'node:crypto';

const supplied = value => Boolean(value?.trim() && !value.includes('REPLACE_'));
const anvilKeys = new Set([
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
]);

/** Whitelist current templates so retired chain credentials cannot enter live imports. */
export function fujiProductionValues(current, local, templates, network, registry) {
  const values = Object.fromEntries(Object.entries(templates).map(([key, fallback]) => [key, current[key] ?? fallback]));
  delete values.PORT;
  Object.assign(values, {
    NODE_ENV: 'production', DEV_MODE: 'false', SIGNER_MODE: 'live',
    AVALANCHE_NETWORK: 'fuji', AVALANCHE_CHAIN_ID: '43113', CHAIN_ID: '43113',
    AVALANCHE_RPC_URL: network.rpcUrl, RPC_URL: network.rpcUrl, RPC_FALLBACK_URL: '',
    AVALANCHE_USDC: network.token, USDC_ADDRESS: network.token,
    AVALANCHE_ENTITLEMENT_REGISTRY: registry ?? '', ENTITLEMENT_STORE: 'avalanche',
    AVALANCHE_CONFIRMATIONS: '2', AVALANCHE_DEMO_SETTLE: 'false', PROVIDER_FUNDED_GAS: 'true',
    BAGSEVEN_REQUIRE_GRANT: 'true', MCP_OAUTH_REQUIRED: 'true', GATEWAY_ALLOW_UNAUTHENTICATED: 'false',
    NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL: network.rpcUrl,
  });
  for (const key of ['AUTH_SECRET', 'DAEMON_AUTH_TOKEN', 'POLICY_INTERNAL_TOKEN', 'PROVIDER_ADMIN_TOKEN',
    'PROVIDER_GAS_ENCRYPTION_KEY', 'PROVIDER_SCOPE_SIGNING_KEY', 'X402_PAYMENT_ENCRYPTION_KEY']) {
    if (!supplied(values[key])) values[key] = randomBytes(32).toString('hex');
  }
  if (values.AUTH_SECRET.length < 32 || /dev-auth|change-in-prod/i.test(values.AUTH_SECRET)) values.AUTH_SECRET = randomBytes(32).toString('hex');
  if (!supplied(values.DAEMON_OWNER_ADDRESS)) values.DAEMON_OWNER_ADDRESS = '';
  // setup-prod derives these from their canonical source; stale copies mislead operators.
  for (const key of ['GATEWAY_AUTH_TOKEN', 'NEXT_PUBLIC_BAGSEVEN_API_URL', 'NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_AVALANCHE_CHAIN_ID', 'NEXT_PUBLIC_AVALANCHE_USDC', 'NEXT_PUBLIC_AVALANCHE_RPC_URL', 'NEXT_PUBLIC_AVALANCHE_EXPLORER']) delete values[key];
  // Preserve the subject derivation secret when moving the existing installation.
  if (!supplied(values.ENTITLEMENT_SUBJECT_SECRET)) values.ENTITLEMENT_SUBJECT_SECRET =
    supplied(local.ENTITLEMENT_SUBJECT_SECRET) ? local.ENTITLEMENT_SUBJECT_SECRET : randomBytes(32).toString('hex');
  for (const key of ['RESEND_API_KEY', 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID']) {
    if (!supplied(values[key]) && supplied(local[key])) values[key] = local[key];
  }
  if (!supplied(values.BAGSEVEN_MCP_WORKER)) values.BAGSEVEN_MCP_WORKER = randomUUID();
  if (!supplied(values.BAGSEVEN_PUBLISHABLE_KEY)) values.BAGSEVEN_PUBLISHABLE_KEY = `pk_live_${randomBytes(16).toString('hex')}`;
  if (!supplied(values.BAGSEVEN_SECRET_KEY)) values.BAGSEVEN_SECRET_KEY = `sk_live_${randomBytes(32).toString('hex')}`;
  if (!supplied(values.DAEMON_OPERATOR_KEY) || anvilKeys.has(values.DAEMON_OPERATOR_KEY.toLowerCase())) {
    values.DAEMON_OPERATOR_KEY = `0x${randomBytes(32).toString('hex')}`;
  }
  // This key signs agent intents only. Providers approve and fund their own transaction signers.
  delete values.MANDATE_DEPLOYER_KEY;
  return values;
}
