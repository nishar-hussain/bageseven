#!/usr/bin/env node
/** Static deployment check. Never prints credentials or contacts live services. */
import { readFileSync, existsSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.env.prod');
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'NEEDS_SETUP'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}
if (!existsSync(path)) {
  console.error('Missing .env.prod. Run pnpm setup:prod first.');
  process.exit(1);
}
const env = parseEnv(readFileSync(path, 'utf8'));
const supplied = key => Boolean(env[key]?.trim() && !env[key].includes('REPLACE_'));
for (const [key, protocols] of [['DATABASE_URL', ['postgres:', 'postgresql:']], ['REDIS_URL', ['redis:', 'rediss:']]]) {
  let valid = /^\$\{\{\s*[^{}\s]+\.[^{}\s]+\s*\}\}$/.test(env[key] ?? '');
  if (!valid) {
    try { valid = protocols.includes(new URL(env[key]).protocol); } catch { /* Do not print credential-bearing URLs. */ }
  }
  check(key, valid, 'Railway reference or connection URL required; attach it to daemon, policy and gateway Variables');
}
for (const key of ['AUTH_SECRET', 'DAEMON_AUTH_TOKEN', 'POLICY_INTERNAL_TOKEN', 'PROVIDER_ADMIN_TOKEN', 'RESEND_API_KEY', 'AVALANCHE_ENTITLEMENT_REGISTRY', 'ENTITLEMENT_SUBJECT_SECRET', 'BAGSEVEN_SECRET_KEY', 'BAGSEVEN_PUBLISHABLE_KEY', 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID']) {
  check(key, supplied(key), 'credential required; value hidden');
}
check('Provider gas encryption key', /^[a-f0-9]{64}$/i.test(env.PROVIDER_GAS_ENCRYPTION_KEY ?? ''), 'must be the same backed-up key on console, daemon and policy');
check('x402 payment encryption key', /^[a-f0-9]{64}$/i.test(env.X402_PAYMENT_ENCRYPTION_KEY ?? '') && env.X402_PAYMENT_ENCRYPTION_KEY !== env.PROVIDER_GAS_ENCRYPTION_KEY, 'preserve a separate daemon-only custody key');
check('Provider scope signing key', /^[a-f0-9]{64}$/i.test(env.PROVIDER_SCOPE_SIGNING_KEY ?? ''), 'share with console, daemon, policy and MCP; keep separate from key encryption');
check('Console pooled database', supplied('CONSOLE_DATABASE_URL'), 'Vercel needs a public pooled PostgreSQL endpoint; Railway private references do not resolve there');
check('Production auth secret', supplied('AUTH_SECRET') && (env.AUTH_SECRET?.length ?? 0) >= 32 && !/dev-auth|change-in-prod/i.test(env.AUTH_SECRET), 'must be a strong production secret, shared with console and daemon');
check('Provider-funded gas', env.PROVIDER_FUNDED_GAS !== 'false', 'platform-funded mode is forbidden in production');
for (const key of ['DAEMON_URL', 'GATEWAY_URL', 'BAGSEVEN_MCP_PUBLIC_URL', 'NEXT_PUBLIC_CONSOLE_URL', 'NEXT_PUBLIC_LANDING_URL']) {
  let valid = false;
  try {
    const url = new URL(env[key]);
    valid = supplied(key) && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.hostname.endsWith('.internal');
  } catch { /* Report the name, never its credential-bearing URL. */ }
  check(key, valid, 'actual public HTTPS origin required');
}
for (const [key, expected] of Object.entries({ NODE_ENV: 'production', DEV_MODE: 'false', SIGNER_MODE: 'live', AVALANCHE_DEMO_SETTLE: 'false', ENTITLEMENT_STORE: 'avalanche', BAGSEVEN_REQUIRE_GRANT: 'true', MCP_OAUTH_REQUIRED: 'true', GATEWAY_ALLOW_UNAUTHENTICATED: 'false' })) {
  check(key, env[key] === expected, `must be ${expected}`);
}
check('Agent operator signer', /^0x[\da-f]{64}$/i.test(env.DAEMON_OPERATOR_KEY ?? ''), 'required for new agent mandate payments');
check('Mandate reads need no platform key', env.PROVIDER_FUNDED_GAS !== 'false', 'capacity checks use a read-only client; provider-approved accounts submit writes');
check('Operator owner wallet', !env.DAEMON_OWNER_ADDRESS || /^0x[\da-f]{40}$/i.test(env.DAEMON_OWNER_ADDRESS), 'optional public legacy allowlist; providers verify their connected wallet');
const chain = env.AVALANCHE_NETWORK === 'mainnet' ? '43114' : '43113';
check('Avalanche chain configuration', env.AVALANCHE_CHAIN_ID === chain && env.CHAIN_ID === chain && env.RPC_URL === env.AVALANCHE_RPC_URL, 'network, IDs and RPC must agree');
check('Avalanche payment token', /^0x[\da-f]{40}$/i.test(env.AVALANCHE_USDC ?? '') && env.USDC_ADDRESS?.toLowerCase() === env.AVALANCHE_USDC?.toLowerCase());
check('Entitlement registry', /^0x[\da-f]{40}$/i.test(env.AVALANCHE_ENTITLEMENT_REGISTRY ?? ''));
for (const key of ['RPC_URL', 'AVALANCHE_RPC_URL']) {
  let valid = false;
  try { const url = new URL(env[key]); valid = url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { /* Hidden. */ }
  check(key, valid, 'live HTTPS RPC required');
}
for (const [file, keys] of [
  ['services/daemon/.env.prod', ['DATABASE_URL', 'REDIS_URL', 'AUTH_SECRET', 'DAEMON_AUTH_TOKEN', 'POLICY_INTERNAL_TOKEN', 'PROVIDER_GAS_ENCRYPTION_KEY', 'X402_PAYMENT_ENCRYPTION_KEY']],
  ['services/policy/.env.prod', ['DATABASE_URL', 'REDIS_URL', 'POLICY_INTERNAL_TOKEN', 'PROVIDER_GAS_ENCRYPTION_KEY']],
  ['services/gateway/.env.prod', ['DATABASE_URL', 'REDIS_URL', 'POLICY_INTERNAL_TOKEN']],
  ['.railway/.env.prod', ['DATABASE_URL', 'REDIS_URL', 'DAEMON_AUTH_TOKEN', 'PROVIDER_GAS_ENCRYPTION_KEY']],
  ['scripts/.env.prod', ['DATABASE_URL', 'DAEMON_AUTH_TOKEN', 'BAGSEVEN_MCP_WORKER', 'PROVIDER_SCOPE_SIGNING_KEY']],
  ['apps/console/.env.prod', ['CONSOLE_DATABASE_URL', 'AUTH_SECRET', 'DAEMON_AUTH_TOKEN', 'PROVIDER_GAS_ENCRYPTION_KEY', 'PROVIDER_SCOPE_SIGNING_KEY']],
]) {
  const data = existsSync(resolve(root, file)) ? parseEnv(readFileSync(resolve(root, file), 'utf8')) : {};
  check(file, keys.every(key => supplied(key) && data[key] === env[key]), 'shared configuration matches production source');
}
console.log('INFO Railway must resolve database/private-network references and run migrations through 0021. Import any existing feature catalog before accepting traffic.');
console.log('INFO Providers must sign gas authorization and fund their dedicated signer with AVAX before customers can check out.');
console.log('INFO This checks files only. Email and wallet sign-in and a wallet-approved checkout still require live verification.');
console.log(`${failures ? `PRODUCTION_NEEDS_SETUP (${failures} checks)` : 'PRODUCTION_CONFIG_OK'}`);
process.exitCode = failures ? 1 : 0;
