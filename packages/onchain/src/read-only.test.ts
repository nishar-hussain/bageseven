import { describe, expect, it } from 'vitest';
import { MandateClient } from './index.js';

describe('read-only mandate access', () => {
  it('requires no private key and refuses every write before attempting RPC', async () => {
    const client = MandateClient.readOnly({ rpcUrl: 'http://127.0.0.1:1', chainId: 43113 });
    const address = '0x1111111111111111111111111111111111111111';
    const worker = `0x${'11'.repeat(32)}` as const;
    expect(client.address).toBe('0x0000000000000000000000000000000000000000');
    await expect(client.execute(address, 1n, address, worker)).rejects.toThrow('READ_ONLY_MANDATE_CLIENT');
    await expect(client.revoke(address)).rejects.toThrow('READ_ONLY_MANDATE_CLIENT');
    await expect(client.withdraw(address, 1n, address)).rejects.toThrow('READ_ONLY_MANDATE_CLIENT');
    await expect(client.deploy({ owner: address, operator: address, enforcer: address, usdc: address, budgetPerWindow: 1n,
      windowSeconds: 86400, lifetimeCap: 1n, perPurchaseCap: 1n, perSellerPct: 10000, maxDepth: 1, rootWorker: worker, rootAllocation: 1n })).rejects.toThrow('READ_ONLY_MANDATE_CLIENT');
  });
});
