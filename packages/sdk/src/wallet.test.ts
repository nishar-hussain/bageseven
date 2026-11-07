import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeWhitechainPayment, payUsdtOnWhitechain } from './wallet.js';
const address = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts') return [address];
    if (method === 'eth_chainId') return '0x752';
    if (method === 'eth_sendTransaction') return hash;
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xa' };
    if (method === 'eth_blockNumber') return '0xb';
    if (method === 'personal_sign') return `0x${'01'.repeat(65)}`;
    return null;
  });
  vi.stubGlobal('window', { ethereum: { request } });
});
afterEach(() => vi.unstubAllGlobals());
describe('buyer wallet checkout', () => {
  it('keeps the submitted receipt available even if the later purchase signature is declined', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => { if (args.method === 'personal_sign') throw new Error('Signature declined'); return original(args); });
    const onTransactionSubmitted = vi.fn();
    await expect(payUsdtOnWhitechain({ merchantWallet: address, amount: '0.05', context: 'checkout:retry', onTransactionSubmitted })).rejects.toThrow('Signature declined');
    expect(onTransactionSubmitted).toHaveBeenCalledExactlyOnceWith(hash);
    expect(request.mock.calls.filter(([args]) => args.method === 'eth_sendTransaction')).toHaveLength(1);
  });
  it('sends exact six-decimal USDT and authorizes a confirmed purchase', async () => {
    const paid = await payUsdtOnWhitechain({ merchantWallet: address, amount: '1.25', context: 'checkout:cs_one' });
    expect(paid).toMatchObject({ payment_tx: hash, customer_wallet: address, payment_signature: `0x${'01'.repeat(65)}` });
    const sent = request.mock.calls.find(([args]) => args.method === 'eth_sendTransaction')![0] as unknown as { params: Array<{ data: string; value: string }> };
    expect(sent.params[0].data.endsWith(1250000n.toString(16).padStart(64, '0'))).toBe(true);
    expect(sent.params[0].value).toBe('0x0');
  });
  it.each(['0', '-1', '1.1234567', 'NaN'])('rejects invalid amount %s without sending funds', async (amount) => {
    await expect(payUsdtOnWhitechain({ merchantWallet: address, amount })).rejects.toThrow();
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('requires a real connected wallet instead of inventing a payer address', async () => {
    vi.stubGlobal('window', {});
    await expect(authorizeWhitechainPayment({ payment_tx: hash, context: 'checkout:cs_one' })).rejects.toThrow('No EVM wallet');
  });
  it('refuses a wallet that remains on another chain', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (args) => args.method === 'eth_chainId' ? '0xa869' : original(args));
    await expect(payUsdtOnWhitechain({ merchantWallet: address, amount: '1' })).rejects.toThrow('wrong network');
  });
});
