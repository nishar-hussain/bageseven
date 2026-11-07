#!/usr/bin/env node
// Read-only readiness check. Never signs a proof, sends a payment, or writes a grant.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainConfig } from '@bagseven/onchain';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileArg = process.argv.indexOf('--env-file');
if (fileArg !== -1 && !process.argv[fileArg + 1]) throw new Error('--env-file requires a path');
const env = { ...process.env, ...parseEnv(readFileSync(resolve(root, fileArg === -1 ? '.env' : process.argv[fileArg + 1]), 'utf8')) };
let failed = false;
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'NEEDS_SETUP'} ${name}: ${detail}`); if (!ok) failed = true; }
if (env.NODE_ENV === 'production') {
  const missing = Object.keys(env).filter(key => env[key]?.includes('REPLACE_'));
  check('Production values supplied', missing.length === 0, missing.length ? `Replace: ${missing.join(', ')}` : 'no placeholders');
  for (const key of ['AUTH_SECRET', 'DAEMON_AUTH_TOKEN', 'RESEND_API_KEY', 'ARKIV_ACCESS_KEY', 'PROVIDER_GAS_ENCRYPTION_KEY']) {
    check(key, Boolean(env[key]?.trim() && !env[key].includes('REPLACE_')), 'required server credential (value hidden)');
  }
  check('Provider-funded gas', env.PROVIDER_FUNDED_GAS !== 'false' && /^[a-f0-9]{64}$/i.test(env.PROVIDER_GAS_ENCRYPTION_KEY ?? ''), 'provider mode requires a shared 32-byte encryption key; each provider authorizes and funds its own signer');
  for (const key of ['DAEMON_URL', 'GATEWAY_URL', 'BAGSEVEN_MCP_PUBLIC_URL', 'NEXT_PUBLIC_CONSOLE_URL', 'NEXT_PUBLIC_LANDING_URL']) {
    let hosted = false;
    try { const url = new URL(env[key]); hosted = url.protocol === 'https:' && !url.username && !url.password && !/localhost|127\.0\.0\.1|REPLACE_/i.test(url.hostname); } catch { /* Report only the field name. */ }
    check(key, hosted, 'requires the actual hosted HTTPS URL');
  }
  check('Persistent grants', env.ENTITLEMENT_STORE === 'arkiv', 'ENTITLEMENT_STORE must be arkiv');
  if (env.WORLD_AGENT_PASS_ENABLED === 'true') check('World OIDC credentials', Boolean(env.WORLD_CLIENT_ID && env.WORLD_CLIENT_SECRET && !env.WORLD_CLIENT_SECRET.includes('REPLACE_')), 'Agent Pass requires its separate client ID and client secret');
}
check('World app', Boolean(env.WORLD_APP_ID?.startsWith('app_') && env.WORLD_RP_ID?.startsWith('rp_')), `${env.WORLD_APP_ID || 'missing app ID'} / ${env.WORLD_RP_ID || 'missing RP ID'}`);
let signerOk = false;
if (env.WORLD_RP_SIGNING_KEY) { try { const key = env.WORLD_RP_SIGNING_KEY; const address = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`)).address; signerOk = address.toLowerCase() === env.WORLD_SIGNER_ADDRESS?.toLowerCase(); } catch { /* Do not expose key parse errors. */ } }
check('World RP signer', signerOk, signerOk ? 'configured key matches registered signer' : 'add WORLD_RP_SIGNING_KEY matching WORLD_SIGNER_ADDRESS locally');
check('World mocks disabled', env.WORLD_MOCK_PROOFS === 'false' && env.WORLD_SKIP_JWKS !== 'true', 'WORLD_MOCK_PROOFS must be false and JWKS verification must remain enabled');
check('Payment mocks disabled', env.WHITECHAIN_DEMO_SETTLE === 'false', 'WHITECHAIN_DEMO_SETTLE must be false');
console.log('INFO Provider payouts: each checkout uses its plan merchant_wallet; no global WHITECHAIN_PAY_TO is required.');
try {
  const config = whitechainConfig(env);
  check('Shared payment token', !env.USDC_ADDRESS || env.USDC_ADDRESS.toLowerCase() === config.usdt.toLowerCase(), 'Legacy USDC_ADDRESS must match WHITECHAIN_USDT; mandates and checkout use the shared Whitechain configuration');
  const rpc = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { timeout: 15000, retryCount: 1 }) });
  const id = await rpc.getChainId(); check('Whitechain RPC', id === config.chainId, `chain ${id}, expected ${config.chainId}`);
  const abi = parseAbi(['function symbol() view returns(string)', 'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)']);
  const [symbol, decimals] = await Promise.all([rpc.readContract({ address: config.usdt, abi, functionName: 'symbol' }), rpc.readContract({ address: config.usdt, abi, functionName: 'decimals' })]);
  check('USDT token', decimals === 6, `${config.usdt} (${symbol}, ${decimals} decimals)`);
  if (/^0x[0-9a-f]{64}$/i.test(env.DAEMON_EXECUTOR_KEY || '')) {
    const account = privateKeyToAccount(env.DAEMON_EXECUTOR_KEY);
    const gas = await rpc.getBalance({ address: account.address });
    const tokens = await rpc.readContract({ address: config.usdt, abi, functionName: 'balanceOf', args: [account.address] });
    check('Mandate executor gas', gas > 0n, `${account.address}: ${gas} wei WBT`);
    console.log(`INFO Executor USDT balance: ${tokens} atomic units. Mandate vault funding and buyer wallet funding must be checked before paid work.`);
  }
} catch { check('Whitechain readiness', false, 'RPC/token checks failed; verify the configured endpoint, chain and token (credentials hidden)'); }
process.exitCode = failed ? 1 : 0;
