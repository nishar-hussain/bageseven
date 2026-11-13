import { describe, expect, it, vi } from 'vitest';
import { connectedSpendingWallet, fundProviderGas, signSpendingMessage } from '../lib/spending-wallet-client';
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

describe('wallet message signing after reconnect', () => {
  const signature = `0x${'ab'.repeat(65)}`;
  it('reauthorizes a stale account and retries the same message once', async () => {
    const request = vi.fn().mockRejectedValueOnce({ code: 4100, message: 'Not authorized' }).mockResolvedValueOnce([]).mockResolvedValueOnce([owner]).mockResolvedValueOnce(signature);
    expect(await signSpendingMessage({ request }, owner, 'Provider authorization')).toBe(signature);
    expect(request.mock.calls.map(call => call[0].method)).toEqual(['personal_sign', 'wallet_requestPermissions', 'eth_requestAccounts', 'personal_sign']);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[3]);
  });
  it.each([4001, -32002])('does not retry or request permissions after wallet error %s', async code => {
    const error = { code, message: 'Wallet rejected' };
    const request = vi.fn().mockRejectedValue(error);
    await expect(signSpendingMessage({ request }, owner, 'Provider authorization')).rejects.toEqual(error);
    expect(request).toHaveBeenCalledOnce();
  });
  it('never signs for another account selected during reconnect', async () => {
    const request = vi.fn().mockRejectedValueOnce({ code: 4100 }).mockResolvedValueOnce([]).mockResolvedValueOnce([other]);
    await expect(signSpendingMessage({ request }, owner, 'Provider authorization')).rejects.toThrow('original provider owner');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('supports wallets without requestPermissions and validates their signature', async () => {
    const request = vi.fn().mockRejectedValueOnce({ code: 4100 }).mockRejectedValueOnce({ code: -32601 }).mockResolvedValueOnce([owner]).mockResolvedValueOnce('not-a-signature');
    await expect(signSpendingMessage({ request }, owner, 'Provider authorization')).rejects.toThrow('valid message signature');
  });
});

describe('provider gas funding balance', () => {
  it('does not request a transfer when Registry has no native funds', async () => {
    const request = vi.fn().mockResolvedValue('0x0');
    await expect(fundProviderGas({ request }, { owner, to: other, value: 1n, symbol: 'AVAX' })).rejects.toThrow('wallet has 0 AVAX');
    expect(request).toHaveBeenCalledOnce();
  });
  it('includes network fees before requesting the exact owner-approved deposit', async () => {
    const request = vi.fn().mockResolvedValueOnce('0x64').mockResolvedValueOnce('0x15').mockResolvedValueOnce('0x1');
    await expect(fundProviderGas({ request }, { owner, to: other, value: 90n, symbol: 'AVAX' })).rejects.toThrow('network fees');
    expect(request).toHaveBeenCalledTimes(3);
    request.mockReset().mockResolvedValueOnce('0x64').mockResolvedValueOnce('0x15').mockResolvedValueOnce('0x1').mockResolvedValueOnce('0xhash');
    await expect(fundProviderGas({ request }, { owner, to: other, value: 10n, symbol: 'AVAX' })).resolves.toBe('0xhash');
    expect(request).toHaveBeenLastCalledWith({ method: 'eth_sendTransaction', params: [{ from: owner, to: other, value: '0xa' }] });
  });
});
