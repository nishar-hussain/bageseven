import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeAvalancheWallet, paymentTokenLabel, connectAvalancheWallet, authorizeAvalanchePayment, payStablecoinOnAvalanche, subscribeOnAvalanche, cancelAvalancheSubscription } from './wallet.js';
const address = '0x1111111111111111111111111111111111111111';
const merchant = '0x2222222222222222222222222222222222222222';
const hash = `0x${'ab'.repeat(32)}`;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts') return [address];
    if (method === 'eth_chainId') return '0xa869';
    if (method === 'eth_call') return '0x5f5e100';
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
  it('blocks a customer paying their own payout wallet before sending a transaction', async () => {
    await expect(payStablecoinOnAvalanche({ merchantWallet: address, usdt: address, amount: '1' })).rejects.toThrow('different wallet');
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('uses the host-selected wallet provider instead of a different injected account', async () => {
    const selected = vi.fn(request.getMockImplementation()!);
    await payStablecoinOnAvalanche({ merchantWallet: merchant, usdt: address, amount: '1', provider: { request: selected } });
    expect(request).not.toHaveBeenCalled();
    expect(selected.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(true);
  });
  it('blocks a self-funded recurring checkout before an allowance request', async () => {
    await expect(subscribeOnAvalanche({ merchantWallet: address, contract: merchant,
      subscribeData: `0x12345678${'00'.repeat(64)}`, amount: '1', usdt: merchant, chainId: 43113, checkoutId: 'self' })).rejects.toThrow('different wallet');
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('pays from the explicitly selected authorized account rather than accounts[0]', async () => {
    const buyer = '0x3333333333333333333333333333333333333333';
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => args.method === 'eth_accounts' ? [address, buyer] : original(args));
    const result = await payStablecoinOnAvalanche({ account: buyer, merchantWallet: merchant, usdt: address, amount: '1' });
    expect(result.customer_wallet).toBe(buyer);
    const sent = request.mock.calls.find(([args]) => args.method === 'eth_sendTransaction')![0] as unknown as { params: Array<{ from: string }> };
    expect(sent.params[0].from).toBe(buyer);
  });
  it('hydrates connected accounts without a prompt and follows account changes and disconnect', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    let initial!: (accounts: string[]) => void;
    const request = vi.fn(() => new Promise<string[]>(resolve => { initial = resolve; }));
    const removeListener = vi.fn((event: string) => listeners.delete(event));
    vi.stubGlobal('window', { ethereum: { request, on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener), removeListener } });
    const account = vi.fn();
    const stop = observeAvalancheWallet(account);
    listeners.get('accountsChanged')!([address]);
    initial([]); await Promise.resolve();
    expect(account).toHaveBeenLastCalledWith(address);
    listeners.get('disconnect')!();
    expect(account).toHaveBeenLastCalledWith('');
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'eth_accounts' });
    stop(); expect(removeListener).toHaveBeenCalledTimes(2);
  });
  it('labels known tokens by chain and contract without mislabelling custom tokens', () => {
    const usdc = '0x5425890298aed601595a70AB815c96711a31Bc65';
    expect(paymentTokenLabel(43113, usdc)).toBe('USDC');
    expect(paymentTokenLabel(43114, usdc)).toContain('Token 0x5425');
    expect(paymentTokenLabel(43113, address)).not.toBe('USDC');
  });
  it.each(['once', 'month'])('explains insufficient USDC before requesting a %s payment', async interval => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => args.method === 'eth_call' ? '0x0' : original(args));
    const token = '0x5425890298aed601595a70AB815c96711a31Bc65';
    const action = interval === 'once'
      ? payStablecoinOnAvalanche({ merchantWallet: merchant, usdt: token, amount: '1' })
      : subscribeOnAvalanche({ merchantWallet: merchant, contract: address, subscribeData: `0x12345678${'00'.repeat(64)}`, amount: '1', usdt: token, chainId: 43113, checkoutId: 'checkout' });
    await expect(action).rejects.toThrow('Insufficient USDC');
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('does not open account or network prompts when the wallet is already connected to Fuji', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => {
      if (args.method === 'eth_accounts') return [address];
      if (['wallet_switchEthereumChain', 'eth_requestAccounts'].includes(args.method)) throw { code: -32002, message: 'A request is already pending in your wallet' };
      return original(args);
    });
    expect((await connectAvalancheWallet()).address).toBe(address);
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['eth_accounts', 'eth_chainId', 'eth_chainId']);
  });
  it('authorizes a bounded allowance before subscribing and preserves the payment receipt', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => args.method === 'eth_call' && !(args as { params?: { data?: string }[] }).params?.[0]?.data?.startsWith('0x70a08231') ? '0x0' : original(args));
    const onTransactionSubmitted = vi.fn();
    const result = await subscribeOnAvalanche({ merchantWallet: merchant, contract: address, subscribeData: `0x12345678${'00'.repeat(64)}`,
      amount: '1.25', usdt: address, chainId: 43113, checkoutId: 'cs_subscription', onTransactionSubmitted });
    const sends = request.mock.calls.filter(([args]) => args.method === 'eth_sendTransaction');
    expect(sends).toHaveLength(2);
    const transactions = sends.map(([args]) => (args as unknown as { params: Array<{ data: string }> }).params[0].data);
    expect(transactions[0].startsWith('0x095ea7b3')).toBe(true);
    expect(transactions[0].endsWith(15000000n.toString(16).padStart(64, '0'))).toBe(true);
    expect(transactions[1]).toBe(`0x12345678${'00'.repeat(64)}`);
    expect(result.payment_tx).toBe(hash); expect(onTransactionSubmitted).toHaveBeenCalledExactlyOnceWith(hash);
  });
  it('does not send a subscription payment when allowance approval is declined', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => {
      if (args.method === 'eth_call' && !(args as { params?: { data?: string }[] }).params?.[0]?.data?.startsWith('0x70a08231')) return '0x0';
      if (args.method === 'eth_sendTransaction') throw Error('Approval declined');
      return original(args);
    });
    await expect(subscribeOnAvalanche({ merchantWallet: merchant, contract: address, subscribeData: `0x12345678${'00'.repeat(64)}`,
      amount: '1', usdt: address, chainId: 43113, checkoutId: 'checkout' })).rejects.toThrow('Approval declined');
    expect(request.mock.calls.filter(([args]) => args.method === 'eth_sendTransaction')).toHaveLength(1);
  });
  it('requires the paying wallet for on-chain cancellation', async () => {
    await expect(cancelAvalancheSubscription({ contract: address, key: `0x${'00'.repeat(32)}`,
      payer: `0x${'22'.repeat(20)}`, chainId: 43113, cancelData: `0x12345678${'00'.repeat(32)}` })).rejects.toThrow('wallet that pays');
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('keeps the submitted receipt available even if the later purchase signature is declined', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async args => { if (args.method === 'personal_sign') throw new Error('Signature declined'); return original(args); });
    const onTransactionSubmitted = vi.fn();
    await expect(payStablecoinOnAvalanche({ merchantWallet: merchant, usdt: address, amount: '0.05', context: 'checkout:retry', onTransactionSubmitted })).rejects.toThrow('Signature declined');
    expect(onTransactionSubmitted).toHaveBeenCalledExactlyOnceWith(hash);
    expect(request.mock.calls.filter(([args]) => args.method === 'eth_sendTransaction')).toHaveLength(1);
  });
  it('sends exact six-decimal stablecoin and authorizes a confirmed purchase', async () => {
    const paid = await payStablecoinOnAvalanche({ merchantWallet: merchant, usdt: address, amount: '1.25', context: 'checkout:cs_one' });
    expect(paid).toMatchObject({ payment_tx: hash, customer_wallet: address, payment_signature: `0x${'01'.repeat(65)}` });
    const sent = request.mock.calls.find(([args]) => args.method === 'eth_sendTransaction')![0] as unknown as { params: Array<{ data: string; value: string }> };
    expect(sent.params[0].data.endsWith(1250000n.toString(16).padStart(64, '0'))).toBe(true);
    expect(sent.params[0].value).toBe('0x0');
  });
  it.each(['0', '-1', '1.1234567', 'NaN'])('rejects invalid amount %s without sending funds', async (amount) => {
    await expect(payStablecoinOnAvalanche({ merchantWallet: merchant, usdt: address, amount })).rejects.toThrow();
    expect(request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false);
  });
  it('requires a real connected wallet instead of inventing a payer address', async () => {
    vi.stubGlobal('window', {});
    await expect(authorizeAvalanchePayment({ payment_tx: hash, context: 'checkout:cs_one' })).rejects.toThrow('No EVM wallet');
  });
  it('refuses a wallet that remains on another chain', async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (args) => args.method === 'eth_chainId' ? '0x1' : original(args));
    await expect(payStablecoinOnAvalanche({ merchantWallet: merchant, usdt: address, amount: '1' })).rejects.toThrow('wrong network');
  });
});
