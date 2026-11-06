#!/usr/bin/env node
// Read-only readiness check. Never signs a proof, sends a payment, or writes a grant.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainConfig } from '@bagseven/onchain';
const env = { ...process.env, ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')) };
let failed = false;
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'NEEDS_SETUP'} ${name}: ${detail}`); if (!ok) failed = true; }
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
  if (env.DAEMON_EXECUTOR_KEY) {
    const account = privateKeyToAccount(env.DAEMON_EXECUTOR_KEY);
    const gas = await rpc.getBalance({ address: account.address });
    const tokens = await rpc.readContract({ address: config.usdt, abi, functionName: 'balanceOf', args: [account.address] });
    check('Mandate executor gas', gas > 0n, `${account.address}: ${gas} wei WBT`);
    console.log(`INFO Executor USDT balance: ${tokens} atomic units. Mandate vault funding and buyer wallet funding must be checked before paid work.`);
  }
} catch (error) { check('Whitechain readiness', false, (error instanceof Error ? error.message : 'RPC check failed').split('\n')[0]); }
process.exitCode = failed ? 1 : 0;
