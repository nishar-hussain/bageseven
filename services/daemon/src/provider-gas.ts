import type { FastifyInstance } from 'fastify';
import type { Database } from '@bagseven/db';
import { ApiError } from '@bagseven/server';
import { ProviderGasManager, providerGasEnabled, verifyProviderScope, whitechainConfig } from '@bagseven/onchain';
import { arkivTransportUrl } from '@bagseven/entitlements';
import { createPublicClient, http, formatEther, type Hex } from 'viem';
import { z } from 'zod';

export function providerFromRequest(req: { headers: Record<string, unknown> }, env: NodeJS.ProcessEnv): string {
  const provider = req.headers['x-bagseven-provider'];
  if (typeof provider !== 'string' || !provider.trim() || !env.DAEMON_AUTH_TOKEN || req.headers.authorization !== `Bearer ${env.DAEMON_AUTH_TOKEN}`) throw new ApiError(403, 'PROVIDER_SCOPE_REQUIRED', 'Use the authenticated provider dashboard');
  if (!verifyProviderScope(req.headers['x-bagseven-provider-scope'], provider, env)) throw new ApiError(403, 'PROVIDER_SCOPE_REQUIRED', 'A server-signed provider session scope is required');
  return provider;
}
export async function assertProviderReady(gas: ProviderGasManager, provider: string, env: NodeJS.ProcessEnv) {
  if (!providerGasEnabled(env)) return;
  try { await gas.assertActive(provider); }
  catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : '';
    if (code === 'PROVIDER_GAS_REQUIRED' || code === 'PROVIDER_GAS_INACTIVE') {
      throw new ApiError(409, code, 'Authorize the provider gas account in Tracks before accepting a checkout');
    }
    throw error;
  }
  const status = await gas.status(provider);
  if (!status.configured) throw new ApiError(409, 'PROVIDER_GAS_REQUIRED', 'Configure provider gas before accepting a checkout');
  const client = createPublicClient({ transport: http(arkivTransportUrl(env.ARKIV_RPC_URL ?? 'https://rpc.rabdi.db-chain.testnet.arkiv.network', env.ARKIV_ACCESS_KEY ?? ''), { timeout: 10000 }) });
  if (await client.getChainId() !== Number(env.ARKIV_CHAIN_ID ?? 7794095)) throw new ApiError(503, 'PROVIDER_GAS_CHAIN_MISMATCH', 'Arkiv RPC is on another network');
  if (await client.getBalance({ address: status.address as `0x${string}` }) === 0n) throw new ApiError(409, 'PROVIDER_GAS_EMPTY', 'Provider must fund its gas account on Arkiv before accepting payments');
}
export function registerProviderGasRoutes(app: FastifyInstance, db: Database, env: NodeJS.ProcessEnv) {
  const gas = new ProviderGasManager(db, env);
  app.get('/internal/provider-gas', async req => {
    const provider = providerFromRequest(req, env);
    const status = await gas.status(provider);
    const config = { enabled: providerGasEnabled(env), whitechain_id: whitechainConfig(env).chainId, arkiv_id: Number(env.ARKIV_CHAIN_ID ?? 7794095) };
    if (!status.configured) return { ...config, ...status };
    const arkiv = createPublicClient({ transport: http(arkivTransportUrl(env.ARKIV_RPC_URL ?? 'https://rpc.rabdi.db-chain.testnet.arkiv.network', env.ARKIV_ACCESS_KEY ?? ''), { timeout: 10000, retryCount: 0 }) });
    const white = createPublicClient({ transport: http(whitechainConfig(env).rpcUrl, { timeout: 10000, retryCount: 0 }) });
    const balances = await Promise.allSettled([white.getBalance({ address: status.address as `0x${string}` }), arkiv.getBalance({ address: status.address as `0x${string}` })]);
    return { ...config, ...status, balances: { whitechain: balances[0].status === 'fulfilled' ? formatEther(balances[0].value) : null, arkiv: balances[1].status === 'fulfilled' ? formatEther(balances[1].value) : null } };
  });
  app.post('/internal/provider-gas/prepare', async req => {
    const provider = providerFromRequest(req, env);
    const body = z.object({ owner: z.string().regex(/^0x[\da-fA-F]{40}$/), whitechainBudget: z.string(), arkivBudget: z.string(), whitechainTxLimit: z.string(), arkivTxLimit: z.string(), expires: z.number().int() }).parse(req.body);
    return gas.prepare(provider, body);
  });
  app.post('/internal/provider-gas/authorize', async req => {
    const provider = providerFromRequest(req, env);
    const body = z.object({ signature: z.string().regex(/^0x[\da-fA-F]{130}$/) }).parse(req.body);
    return gas.authorize(provider, body.signature as `0x${string}`);
  });
  app.post('/internal/provider-gas/revoke', async req => gas.revoke(providerFromRequest(req, env)));
  app.post('/internal/provider-gas/recovery', async req => {
    const body = z.object({ network: z.enum(['arkiv', 'whitechain']), amount: z.string() }).parse(req.body);
    return gas.prepareRecovery(providerFromRequest(req, env), body.network, body.amount);
  });
  app.post('/internal/provider-gas/recover', async req => {
    const body = z.object({ signature: z.string().regex(/^0x[\da-fA-F]{130}$/) }).parse(req.body);
    return gas.recover(providerFromRequest(req, env), body.signature as Hex);
  });
}
