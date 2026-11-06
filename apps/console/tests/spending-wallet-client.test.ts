import { describe, expect, it, vi } from 'vitest';
import { connectedSpendingWallet } from '../lib/spending-wallet-client';
const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
describe('active connector for agent spending', () => {
  it('uses the selected connector and account even when that account is not first', async () => {
    const wallet = { request: vi.fn(async () => [other, owner]) };
    const connector = { getProvider: vi.fn(async () => wallet) };
    expect(await connectedSpendingWallet(connector, owner, owner)).toBe(wallet);
    expect(connector.getProvider).toHaveBeenCalledOnce();
    expect(wallet.request).toHaveBeenCalledExactlyOnceWith({ method: 'eth_accounts' });
  });
  it('rejects a stale selected account and explains a different mandate owner', async () => {
    const connector = { getProvider: async () => ({ request: async () => [owner] }) };
    await expect(connectedSpendingWallet(connector, other)).rejects.toThrow('account changed');
    await expect(connectedSpendingWallet(connector, owner, other)).rejects.toThrow(`belongs to ${other}`);
  });
  it('reports a disconnected connector without falling back to an injected wallet', async () => {
    await expect(connectedSpendingWallet({ getProvider: async () => undefined }, owner)).rejects.toThrow('disconnected');
  });
});
