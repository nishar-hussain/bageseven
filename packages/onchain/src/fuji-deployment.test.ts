import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, type PublicClient } from 'viem';
import { FUJI_DEPLOYMENT, assertPublicFuji, validateSignedRegistry, type RegistryDeploymentPlan } from './fuji-deployment.js';
import { EntitlementRegistryBytecode, EntitlementRegistryRuntime } from './entitlement-registry-artifact.js';

const account = privateKeyToAccount(`0x${'12'.repeat(32)}`);
const plan: RegistryDeploymentPlan = { kind: 'bagseven_fuji_registry_v1', owner: account.address, nonce: 0,
  chainId: 43113, genesis: FUJI_DEPLOYMENT.genesis, gas: '4000000', maxFeePerGas: '2000000000',
  maxPriorityFeePerGas: '1000000000', bytecodeHash: keccak256(EntitlementRegistryBytecode),
  runtimeHash: keccak256(EntitlementRegistryRuntime), createdAt: Date.now() };
const tx = { type: 'eip1559' as const, chainId: 43113, nonce: 0, gas: 4000000n, maxFeePerGas: 2000000000n,
  maxPriorityFeePerGas: 1000000000n, value: 0n, data: EntitlementRegistryBytecode };
describe('secure public Fuji deployment', () => {
  it('rejects Anvil even when its chain ID is Fuji', async () => {
    const client = { getChainId: async () => 43113, getBlock: async () => ({ hash: `0x${'00'.repeat(32)}` }) } as unknown as PublicClient;
    await expect(assertPublicFuji(client)).rejects.toThrow('PUBLIC_FUJI_REQUIRED');
  });
  it('accepts only the reviewed deployment and signer', async () => {
    const raw = await account.signTransaction(tx);
    expect((await validateSignedRegistry(plan, raw)).hash).toBe(keccak256(raw));
    const other = privateKeyToAccount(`0x${'13'.repeat(32)}`);
    await expect(validateSignedRegistry(plan, await other.signTransaction(tx))).rejects.toThrow('DEPLOYMENT_SIGNER_MISMATCH');
  });
  it.each([
    { value: 1n }, { to: account.address }, { chainId: 1 }, { nonce: 1 }, { data: '0x' as const },
    { gas: 5000000n }, { maxFeePerGas: 3000000000n }, { maxPriorityFeePerGas: 2n },
  ])('rejects an altered signed transaction %#', async change => {
    await expect(validateSignedRegistry(plan, await account.signTransaction({ ...tx, ...change }))).rejects.toThrow('SIGNED_DEPLOYMENT_MISMATCH');
  });
});
