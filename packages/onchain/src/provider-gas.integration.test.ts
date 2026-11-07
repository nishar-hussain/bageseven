import { describe, expect, it } from 'vitest';
import { createDb, providerGasAccounts } from '@bagseven/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { encodeFunctionData, formatEther, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ARKIV_ENGINE, ProviderGasManager } from './provider-gas.js';

describe.skipIf(!process.env.BAGSEVEN_GAS_DB_TEST_URL)('provider gas real PostgreSQL enforcement (no broadcast)', () => {
  it('authorizes an isolated account, atomically caps concurrent signing, and revokes future signing', async () => {
    const db = createDb({ connectionString: process.env.BAGSEVEN_GAS_DB_TEST_URL! });
    const provider = `gas-test:${randomUUID()}`;
    const owner = privateKeyToAccount(generatePrivateKey());
    const manager = new ProviderGasManager(db, { PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32) });
    try {
      const prepared = await manager.prepare(provider, { owner: owner.address, whitechainBudget: formatEther(42000n), arkivBudget: formatEther(42000n), whitechainTxLimit: formatEther(21000n), arkivTxLimit: formatEther(21000n), expires: Date.now() + 86400000 });
      const sig = await owner.signMessage({ message: prepared.message });
      await manager.authorize(provider, sig);
      await expect(manager.authorize(provider, sig)).rejects.toThrow('CHALLENGE_EXPIRED');
      const row = await db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
      expect(row?.encryptedKey).not.toContain(owner.address);
      expect(JSON.stringify(await manager.status(provider))).not.toContain('encryptedKey');
      const account = await manager.account(provider, 'arkiv');
      const data = encodeFunctionData({ abi: parseAbi(['function execute((uint8 operation,bytes operationData)[] ops)']), functionName: 'execute', args: [[{ operation: 1, operationData: '0x' }]] });
      const attempts = await Promise.allSettled([0, 1, 2].map(nonce => account.signTransaction({ chainId: 7794095, type: 'legacy', nonce, gas: 21000n, gasPrice: 1n, to: ARKIV_ENGINE, data })));
      expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(2);
      expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect((await manager.status(provider))).toMatchObject({ arkiv_reserved_wei: '42000' });
      await manager.revoke(provider);
      await expect(account.signTransaction({ chainId: 7794095, type: 'legacy', nonce: 3, gas: 21000n, gasPrice: 1n, to: ARKIV_ENGINE, data })).rejects.toThrow('INACTIVE');
    } finally {
      await db.delete(providerGasAccounts).where(eq(providerGasAccounts.providerId, provider));
      // Drizzle owns the underlying pool; close it so the optional integration test exits.
      await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
    }
  });
});
