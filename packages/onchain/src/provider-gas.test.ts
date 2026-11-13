import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, encodeDeployData, parseAbi, parseEther, recoverTransactionAddress, keccak256, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { providerGasAccounts, providerSignedTransactions, entitlementRecords, type Database } from '@bagseven/db';
import { EntitlementRegistryAbi } from './entitlement-registry-artifact.js';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ProviderGasManager, encryptGasKey, gasAuthorizationMessage, providerGasEnabled, type GasAuthorization } from './provider-gas.js';
const REGISTRY_ENGINE = '0x3333333333333333333333333333333333333333';
import { SubscriptionAbi, SubscriptionBytecode } from './subscription-artifact.js';
import { BagMandateAbi } from './abi.js';
import { BagMandateBytecode } from './bytecode.js';
const rpc = vi.hoisted(() => ({ send: vi.fn(), wallet: vi.fn() }));
vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(),
  createPublicClient: () => ({ getChainId: async () => 43113, getBalance: async () => 10n ** 18n, estimateGas: async () => 21000n, getGasPrice: async () => 1n, getTransactionCount: async () => 0 }),
  createWalletClient: (options: unknown) => { rpc.wallet(options); return { sendTransaction: rpc.send }; },
}));
const key = `0x${'01'.repeat(32)}` as Hex;
const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const provider = 'account:provider-one';
const env = { PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32), AVALANCHE_ENTITLEMENT_REGISTRY: REGISTRY_ENGINE, AVALANCHE_USDC: '0x4444444444444444444444444444444444444444' };
const data = encodeFunctionData({ abi: EntitlementRegistryAbi, functionName: 'consume', args: [`0x${'aa'.repeat(32)}`, 1n, `0x${'bb'.repeat(32)}`] });
const tx = { chainId: 43113, type: 'legacy' as const, nonce: 0, to: REGISTRY_ENGINE as Hex, gas: 21000n, gasPrice: 1n, data };
function fixture() {
  const a: GasAuthorization = { provider, owner: owner.address.toLowerCase(), address: privateKeyToAccount(key).address.toLowerCase(), nonce: 'auth-nonce', challengeExpires: Date.now() + 300000, expires: Date.now() + 86400000, avalancheId: 43113, registryId: 43113,
    avalancheBudget: '0.1', registryBudget: '0.1', avalancheTxLimit: '0.01', registryTxLimit: '0.01' };
  const row = { providerId: provider, ownerAddress: a.owner, address: a.address, encryptedKey: encryptGasKey(key, provider, env), status: 'active', authorization: a, challenge: { ...a, nonce: 'next-auth' }, expiresAt: new Date(a.expires), avalancheReserved: '0', registryReserved: '0' };
  const returning = vi.fn(async () => [{ id: provider }]);
  const mandate = { providerId: provider, contractAddress: owner.address.toLowerCase() };
  const set = vi.fn((values: object) => { Object.assign(row, values); return { where: () => ({ returning }) }; });
  const selected: unknown[] = [];
  const signatures: { id: string; providerId: string; chainId: number; intent?: string; raw: string }[] = [];
  const dialect = new PgDialect();
  const select = () => ({ from: (table: unknown) => ({ where: (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const values = dialect.sqlToQuery(condition).params;
    const rows = table === entitlementRecords ? [{ providerId: provider }] : table === providerGasAccounts ? [row] : table === providerSignedTransactions
      ? signatures.filter(r => values.length === 1 ? r.id === values[0] : r.providerId === values[0] && r.chainId === values[1] && r.intent === values[2]) : selected;
    return Object.assign(Promise.resolve(rows), { for: async () => rows });
  } }) });
  let queue = Promise.resolve();
  const context = { select, update: () => ({ set }), insert: () => ({ values: async (value: typeof signatures[number]) => { signatures.push(value); } }) };
  const db = { ...context, query: { providerGasAccounts: { findFirst: async () => row }, mandates: { findFirst: async () => mandate } },
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const previous = queue; let release!: () => void; queue = new Promise<void>(r => { release = r; });
      await previous; try { return await run(context); } finally { release(); }
    } } as unknown as Database;
  return { manager: new ProviderGasManager(db, env), row, returning, set, mandate, selected };
}
describe('provider-funded restricted signing', () => {
  it('rejects conflicting Avalanche signatures for the same provider nonce across concurrent callers', async () => {
    const { manager, row } = fixture();
    const account = await manager.account(provider, 'avalanche');
    const call = encodeFunctionData({ abi: parseAbi(['function execute(uint256,address,bytes32)']), functionName: 'execute', args: [1n, owner.address, `0x${'00'.repeat(32)}`] });
    const results = await Promise.allSettled([
      account.signTransaction({ ...tx, chainId: 43113, to: owner.address, data: call }),
      account.signTransaction({ ...tx, chainId: 43113, to: owner.address, data: encodeFunctionData({ abi: parseAbi(['function execute(uint256,address,bytes32)']), functionName: 'execute', args: [2n, owner.address, `0x${'00'.repeat(32)}`] }) }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(row.address).toBe(account.address.toLowerCase());
  });
  it('permits only the provider-owned deployment and recorded mandate methods on Avalanche', async () => {
    const { manager, row, mandate } = fixture();
    const account = await manager.account(provider, 'avalanche');
    const args = [owner.address, owner.address, row.address, owner.address, 1000000n, 86400n, 10000000n, 100000n, 10000n, 2, `0x${'00'.repeat(32)}`, 10000000n] as const;
    const deployment = encodeDeployData({ abi: BagMandateAbi, bytecode: BagMandateBytecode, args });
    await expect(account.signTransaction({ ...tx, chainId: 43113, to: undefined, data: deployment })).resolves.toMatch(/^0x/);
    const wrong = encodeDeployData({ abi: BagMandateAbi, bytecode: BagMandateBytecode, args: [row.address, ...args.slice(1)] });
    await expect(account.signTransaction({ ...tx, chainId: 43113, to: undefined, data: wrong })).rejects.toThrow('FORBIDDEN');
    const call = encodeFunctionData({ abi: parseAbi(['function execute(uint256,address,bytes32)']), functionName: 'execute', args: [1n, owner.address, `0x${'00'.repeat(32)}`] });
    await expect(account.signTransaction({ ...tx, nonce: 1, chainId: 43113, to: owner.address, data: call })).resolves.toMatch(/^0x/);
    mandate.providerId = 'another-provider';
    await expect(account.signTransaction({ ...tx, chainId: 43113, to: owner.address, data: call })).rejects.toThrow('FORBIDDEN');
  });
  it('requires explicit subscription permission and limits deployments and collections to provider-owned plan terms', async () => {
    const { manager, row, selected, mandate } = fixture();
    const call = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [`0x${'00'.repeat(32)}`, 1800000000n] });
    mandate.providerId = 'other-provider';
    const account = await manager.account(provider, 'avalanche');
    await expect(account.signTransaction({ ...tx, chainId: 43113, to: owner.address, data: call })).rejects.toThrow('FORBIDDEN');
    row.authorization.subscriptions = true;
    selected.push({ providerId: provider, data: { contract: owner.address, status: 'ready' } });
    await expect(account.signTransaction({ ...tx, nonce: 1, chainId: 43113, to: owner.address, data: call })).resolves.toMatch(/^0x/);
    selected.length = 0;
    selected.push({ id: 'plan', providerId: provider, active: 'true', interval: 'month', merchantWallet: owner.address, amount: '1', ttlSeconds: 2592000 });
    const args = [env.AVALANCHE_USDC as Hex, owner.address, row.address as Hex, 1000000n, 2592000n, keccak256(stringToHex('plan'))] as const;
    const deployment = encodeDeployData({ abi: SubscriptionAbi, bytecode: SubscriptionBytecode, args });
    await expect(account.signTransaction({ ...tx, chainId: 43113, to: undefined, data: deployment })).resolves.toMatch(/^0x/);
    const wrong = encodeDeployData({ abi: SubscriptionAbi, bytecode: SubscriptionBytecode, args: [args[0], row.address as Hex, ...args.slice(2)] });
    await expect(account.signTransaction({ ...tx, chainId: 43113, to: undefined, data: wrong })).rejects.toThrow('FORBIDDEN');
  });
  it('requires revocation and a fresh owner signature for native recovery, never an automatic delegate', async () => {
    rpc.send.mockReset().mockResolvedValue(`0x${'ab'.repeat(32)}`);
    const { manager, row } = fixture();
    await expect(manager.prepareRecovery(provider, 'avalanche', '0.1')).rejects.toThrow('REVOKE_FIRST');
    await manager.revoke(provider);
    const draft = await manager.prepareRecovery(provider, 'avalanche', '0.1');
    const bad = await privateKeyToAccount(key).signMessage({ message: draft.message });
    await expect(manager.recover(provider, bad)).rejects.toThrow('SIGNATURE_INVALID');
    expect(rpc.send).not.toHaveBeenCalled();
    await manager.recover(provider, await owner.signMessage({ message: draft.message }));
    expect(rpc.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 43113, to: row.ownerAddress, value: parseEther('0.1'), nonce: 0 }));
    await expect(manager.recover(provider, await owner.signMessage({ message: draft.message }))).rejects.toThrow('CHALLENGE_EXPIRED');
  });
  it('is enabled by default and encrypts keys with provider-bound authentication', async () => {
    expect(providerGasEnabled({})).toBe(true);
    const { manager, row } = fixture();
    expect(row.encryptedKey).not.toContain(key);
    expect(JSON.stringify(await manager.status(provider))).not.toContain('encryptedKey');
    await expect(manager.account('another-provider', 'registry')).rejects.toThrow();
  });
  it('signs an allowed entity write with the provider account instead of a platform key', async () => {
    const { manager, row, returning } = fixture();
    const account = await manager.account(provider, 'registry');
    const signed = await account.signTransaction(tx);
    expect((await recoverTransactionAddress({ serializedTransaction: signed })).toLowerCase()).toBe(row.address);
    expect(returning).toHaveBeenCalledOnce();
  });
  it('rejects native transfers, arbitrary calls, another chain, and ownership-change entity operations', async () => {
    const { manager, returning } = fixture(); const account = await manager.account(provider, 'registry');
    await expect(account.signTransaction({ ...tx, value: 1n })).rejects.toThrow('FORBIDDEN');
    await expect(account.signTransaction({ ...tx, chainId: 1 })).rejects.toThrow('FORBIDDEN');
    await expect(account.signTransaction({ ...tx, to: owner.address })).rejects.toThrow('FORBIDDEN');
    const forbidden = encodeFunctionData({ abi: parseAbi(['function execute((uint8 operation,bytes operationData)[] ops)']), functionName: 'execute', args: [[{ operation: 4, operationData: '0x' }]] });
    await expect(account.signTransaction({ ...tx, data: forbidden })).rejects.toThrow('FORBIDDEN');
    await expect(account.signMessage({ message: 'not delegated' })).rejects.toThrow('FORBIDDEN');
    expect(returning).not.toHaveBeenCalled();
  });
  it('enforces a fee bound, a reserved budget, expiry and revocation before signing', async () => {
    const { manager, row, returning } = fixture(); const account = await manager.account(provider, 'registry');
    await expect(account.signTransaction({ ...tx, gas: undefined })).rejects.toThrow('FEE_REQUIRED');
    await expect(account.signTransaction({ ...tx, gasPrice: 10n ** 18n })).rejects.toThrow('TX_LIMIT');
    returning.mockResolvedValue([]);
    await expect(account.signTransaction(tx)).rejects.toThrow('BUDGET');
    row.status = 'revoked';
    await expect(account.signTransaction(tx)).rejects.toThrow('INACTIVE');
    row.status = 'active'; row.expiresAt = new Date(0);
    await expect(account.signTransaction(tx)).rejects.toThrow('INACTIVE');
  });
  it('requires the owner signature for a fresh bounded authorization and rejects challenge replay', async () => {
    const { manager, row } = fixture();
    const signature = await owner.signMessage({ message: gasAuthorizationMessage(row.challenge) });
    const bad = await privateKeyToAccount(key).signMessage({ message: gasAuthorizationMessage(row.challenge) });
    await expect(manager.authorize(provider, bad)).rejects.toThrow('SIGNATURE_INVALID');
    await expect(manager.authorize(provider, signature)).resolves.toHaveProperty('address', row.address);
    await expect(manager.authorize(provider, signature)).rejects.toThrow('CHALLENGE_EXPIRED');
  });
});
