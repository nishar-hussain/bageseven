import { describe, expect, it } from 'vitest';
import { createDb, providerGasAccounts, providerSignedTransactions, entitlementRecords } from '@bagseven/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { encodeFunctionData, formatEther, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ProviderGasManager } from './provider-gas.js';
import { EntitlementRegistryAbi } from './entitlement-registry-artifact.js';
const REGISTRY_ENGINE = '0x3333333333333333333333333333333333333333';

describe.skipIf(!process.env.BAGSEVEN_GAS_DB_TEST_URL)('provider gas real PostgreSQL enforcement (no broadcast)', () => {
  it('authorizes an isolated account, atomically caps concurrent signing, and revokes future signing', async () => {
    const db = createDb({ connectionString: process.env.BAGSEVEN_GAS_DB_TEST_URL! });
    const provider = `gas-test:${randomUUID()}`;
    const owner = privateKeyToAccount(generatePrivateKey());
    const manager = new ProviderGasManager(db, { PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32), AVALANCHE_ENTITLEMENT_REGISTRY: REGISTRY_ENGINE });
    try {
      const prepared = await manager.prepare(provider, { owner: owner.address, avalancheBudget: formatEther(42000n), registryBudget: formatEther(42000n), avalancheTxLimit: formatEther(21000n), registryTxLimit: formatEther(21000n), expires: Date.now() + 86400000 });
      const sig = await owner.signMessage({ message: prepared.message });
      await manager.authorize(provider, sig);
      await expect(manager.authorize(provider, sig)).rejects.toThrow('CHALLENGE_EXPIRED');
      const row = await db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
      expect(row?.encryptedKey).not.toContain(owner.address);
      expect(JSON.stringify(await manager.status(provider))).not.toContain('encryptedKey');
      const account = await manager.account(provider, 'registry');
      const id = `0x${'aa'.repeat(32)}` as const;
      await db.insert(entitlementRecords).values({ key: `43113:${REGISTRY_ENGINE}:${id}`, chainId: 43113, registry: REGISTRY_ENGINE, providerId: provider, kind: 'grant', data: {} }).onConflictDoNothing();
      const call = (nonce: number) => encodeFunctionData({ abi: EntitlementRegistryAbi, functionName: 'consume', args: [id, 1n, `0x${nonce.toString(16).padStart(64, '0')}`] });
      const data = call(4);
      const attempts = await Promise.allSettled([0, 1, 2].map(nonce => account.signTransaction({ chainId: 43113, type: 'legacy', nonce, gas: 21000n, gasPrice: 1n, to: REGISTRY_ENGINE, data: call(nonce) })));
      expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(2);
      expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect((await manager.status(provider))).toMatchObject({ registry_reserved_wei: '42000' });
      await manager.revoke(provider);
      await expect(account.signTransaction({ chainId: 43113, type: 'legacy', nonce: 3, gas: 21000n, gasPrice: 1n, to: REGISTRY_ENGINE, data })).rejects.toThrow('INACTIVE');
    } finally {
      await db.delete(entitlementRecords).where(eq(entitlementRecords.providerId, provider));
      await db.delete(providerSignedTransactions).where(eq(providerSignedTransactions.providerId, provider));
      await db.delete(providerGasAccounts).where(eq(providerGasAccounts.providerId, provider));
      // Drizzle owns the underlying pool; close it so the optional integration test exits.
      await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
    }
  });
});
