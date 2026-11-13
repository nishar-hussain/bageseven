import { CredentialStore, type Database } from '@bagseven/db';
import { EntitlementRegistryBytecode, EntitlementRegistryRuntime, avalancheFuji } from '@bagseven/onchain';
import { ApiError } from '@bagseven/server';
import { createPublicClient, http, keccak256, parseAbi, type Hex } from 'viem';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { providerFromRequest } from './provider-gas.js';

const rpcUrl = 'https://api.avax-test.network/ext/bc/C/rpc';
const token = '0x5425890298aed601595a70AB815c96711a31Bc65' as const;
type Deployment = { exp: number; owner: string; address: string; transaction: string; chain_id: number; token: string; rpc_url: string };
export function registerRegistryDeployment(app: FastifyInstance, db: Database, env: NodeJS.ProcessEnv) {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl, { timeout: 15000, retryCount: 1 }) });
  const deployments = new CredentialStore<Deployment>(db, 'verified-fuji-registry');
  const ownerSchema = z.string().regex(/^0x[\da-f]{40}$/i);
  app.post('/internal/deployments/registry/prepare', async req => {
    const provider = providerFromRequest(req, env);
    const { owner } = z.object({ owner: ownerSchema }).parse(req.body);
    const saved = await deployments.get(provider);
    if (saved) return { deployment: saved };
    if (await client.getChainId() !== 43113) throw Error('FUJI_RPC_CHAIN_MISMATCH');
    const abi = parseAbi(['function decimals() view returns(uint8)', 'function version() view returns(string)', 'function authorizationState(address,bytes32) view returns(bool)']);
    const [decimals, version, genesis, gas, price, balance] = await Promise.all([
      client.readContract({ address: token, abi, functionName: 'decimals' }),
      client.readContract({ address: token, abi, functionName: 'version' }),
      client.getBlock({ blockNumber: 0n }),
      client.estimateGas({ account: owner as Hex, data: EntitlementRegistryBytecode }),
      client.getGasPrice(), client.getBalance({ address: owner as Hex }),
      client.readContract({ address: token, abi, functionName: 'authorizationState', args: [owner as Hex, `0x${'00'.repeat(32)}`] }),
    ]);
    if (decimals !== 6 || version !== '2') throw Error('FUJI_TOKEN_UNSUPPORTED');
    return { chain_id: 43113, rpc_url: rpcUrl, token, genesis_hash: genesis.hash, balance_wei: balance.toString(),
      estimated_max_fee_wei: (gas * price * 2n).toString(),
      transaction: { from: owner, data: EntitlementRegistryBytecode, value: '0x0' },
      note: 'Deploys only the entitlement registry on public Avalanche Fuji. Requires your wallet approval and test AVAX. Does not switch the local deployment or authorize customer payments.' };
  });
  app.post('/internal/deployments/registry/confirm', async req => {
    const provider = providerFromRequest(req, env);
    const body = z.object({ owner: ownerSchema, hash: z.string().regex(/^0x[\da-f]{64}$/i) }).parse(req.body);
    if (await client.getChainId() !== 43113) throw Error('FUJI_RPC_CHAIN_MISMATCH');
    const hash = body.hash as Hex;
    const receipt = await client.getTransactionReceipt({ hash });
    const tx = await client.getTransaction({ hash });
    const head = await client.getBlockNumber({ cacheTime: 0 });
    if (receipt.status !== 'success' || !receipt.contractAddress || head < receipt.blockNumber + 1n) throw new ApiError(409, 'DEPLOYMENT_PENDING', 'Wait for two Fuji confirmations, then verify the same transaction');
    if (tx.from.toLowerCase() !== body.owner.toLowerCase() || tx.to !== null || tx.value !== 0n || tx.input !== EntitlementRegistryBytecode) throw new ApiError(400, 'DEPLOYMENT_MISMATCH', 'Transaction does not deploy this registry from your verified wallet');
    const code = await client.getCode({ address: receipt.contractAddress });
    if (!code || keccak256(code) !== keccak256(EntitlementRegistryRuntime)) throw Error('DEPLOYMENT_RUNTIME_MISMATCH');
    const deployment: Deployment = { exp: Date.now() + 10 * 365 * 86400000, owner: body.owner.toLowerCase(), address: receipt.contractAddress,
      transaction: hash, chain_id: 43113, token, rpc_url: rpcUrl };
    await deployments.set(provider, deployment);
    return { deployment, environment: { AVALANCHE_NETWORK: 'fuji', AVALANCHE_CHAIN_ID: '43113', AVALANCHE_RPC_URL: rpcUrl,
      AVALANCHE_USDC: token, AVALANCHE_ENTITLEMENT_REGISTRY: deployment.address, ENTITLEMENT_STORE: 'avalanche' } };
  });
}
