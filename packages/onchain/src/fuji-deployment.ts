import { getContractAddress, keccak256, parseTransaction, recoverTransactionAddress, type Hex, type PublicClient } from 'viem';
import { EntitlementRegistryBytecode, EntitlementRegistryRuntime } from './entitlement-registry-artifact.js';

export const FUJI_DEPLOYMENT = {
  chainId: 43113,
  rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
  token: '0x5425890298aed601595a70AB815c96711a31Bc65',
  genesis: '0x31ced5b9beb7f8782b014660da0cb18cc409f121f408186886e1ca3e8eeca96b',
} as const;
export type RegistryDeploymentPlan = {
  kind: 'bagseven_fuji_registry_v1'; owner: Hex; nonce: number; chainId: 43113;
  genesis: Hex; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string;
  bytecodeHash: Hex; runtimeHash: Hex; createdAt: number;
};
export async function assertPublicFuji(client: PublicClient) {
  const [chain, genesis] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber: 0n })]);
  if (chain !== FUJI_DEPLOYMENT.chainId || genesis.hash !== FUJI_DEPLOYMENT.genesis) throw Error('PUBLIC_FUJI_REQUIRED: this RPC is Anvil or another network, even if its chain ID is 43113');
}
export async function prepareFujiRegistry(client: PublicClient, owner: Hex): Promise<RegistryDeploymentPlan> {
  if (!/^0x[\da-f]{40}$/i.test(owner)) throw Error('INVALID_DEPLOYMENT_OWNER');
  await assertPublicFuji(client);
  const [nonce, estimated, fees] = await Promise.all([
    client.getTransactionCount({ address: owner, blockTag: 'pending' }),
    client.estimateGas({ account: owner, data: EntitlementRegistryBytecode }),
    client.estimateFeesPerGas(),
  ]);
  return { kind: 'bagseven_fuji_registry_v1', owner, nonce, chainId: 43113, genesis: FUJI_DEPLOYMENT.genesis,
    gas: (estimated * 125n / 100n).toString(), maxFeePerGas: fees.maxFeePerGas!.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas!.toString(),
    bytecodeHash: keccak256(EntitlementRegistryBytecode), runtimeHash: keccak256(EntitlementRegistryRuntime), createdAt: Date.now() };
}
export function validateRegistryPlan(plan: RegistryDeploymentPlan) {
  if (plan.kind !== 'bagseven_fuji_registry_v1' || plan.chainId !== 43113 || plan.genesis !== FUJI_DEPLOYMENT.genesis ||
    !/^0x[\da-f]{40}$/i.test(plan.owner) || !Number.isSafeInteger(plan.nonce) || plan.nonce < 0 ||
    plan.bytecodeHash !== keccak256(EntitlementRegistryBytecode) || plan.runtimeHash !== keccak256(EntitlementRegistryRuntime) ||
    ![plan.gas, plan.maxFeePerGas, plan.maxPriorityFeePerGas].every(v => typeof v === 'string' && /^\d+$/.test(v)) ||
    BigInt(plan.gas) <= 0n || BigInt(plan.maxFeePerGas) <= 0n || BigInt(plan.maxPriorityFeePerGas) > BigInt(plan.maxFeePerGas)) throw Error('DEPLOYMENT_PLAN_MISMATCH');
}
export async function validateSignedRegistry(plan: RegistryDeploymentPlan, raw: Hex) {
  validateRegistryPlan(plan);
  if (!raw.startsWith('0x02')) throw Error('SIGNED_DEPLOYMENT_MISMATCH: expected EIP-1559');
  const tx = parseTransaction(raw);
  if (tx.type !== 'eip1559' || tx.chainId !== plan.chainId || tx.nonce !== plan.nonce || tx.to ||
    BigInt(tx.value ?? 0) !== 0n || tx.data !== EntitlementRegistryBytecode || tx.gas !== BigInt(plan.gas) ||
    tx.maxFeePerGas !== BigInt(plan.maxFeePerGas) || tx.maxPriorityFeePerGas !== BigInt(plan.maxPriorityFeePerGas) ||
    tx.accessList?.length) throw Error('SIGNED_DEPLOYMENT_MISMATCH: refusing a different transaction or fee');
  const signer = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` });
  if (signer.toLowerCase() !== plan.owner.toLowerCase()) throw Error('DEPLOYMENT_SIGNER_MISMATCH');
  return { hash: keccak256(raw), address: getContractAddress({ from: signer, nonce: BigInt(plan.nonce) }) };
}
export async function verifyFujiRegistry(client: PublicClient, hash: Hex, owner: Hex) {
  await assertPublicFuji(client);
  const [receipt, transaction, head] = await Promise.all([
    client.getTransactionReceipt({ hash }), client.getTransaction({ hash }), client.getBlockNumber({ cacheTime: 0 }),
  ]);
  if (receipt.status !== 'success' || !receipt.contractAddress || head < receipt.blockNumber + 1n) throw Error('DEPLOYMENT_PENDING: wait for two public Fuji confirmations');
  if (transaction.from.toLowerCase() !== owner.toLowerCase() || transaction.to || transaction.value !== 0n || transaction.input !== EntitlementRegistryBytecode) throw Error('DEPLOYMENT_TRANSACTION_MISMATCH');
  const code = await client.getCode({ address: receipt.contractAddress });
  if (!code || keccak256(code) !== keccak256(EntitlementRegistryRuntime)) throw Error('DEPLOYMENT_RUNTIME_MISMATCH');
  return { chain_id: 43113, rpc_url: FUJI_DEPLOYMENT.rpcUrl, token: FUJI_DEPLOYMENT.token, owner: owner.toLowerCase(),
    address: receipt.contractAddress, transaction: hash, block: receipt.blockNumber.toString(), genesis: FUJI_DEPLOYMENT.genesis };
}
