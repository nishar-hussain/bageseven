import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { verifyWhitechainPayment } from './whitechain-payment.js';
const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), readContract: vi.fn(), getTransactionReceipt: vi.fn(), getBlockNumber: vi.fn() }));
vi.mock('viem', async (original) => ({ ...await original<typeof import('viem')>(), createPublicClient: () => rpc }));
const token = '0xaa7962d073935D387e8d442DA1D7149C81388f46';
const from = '0x1111111111111111111111111111111111111111', to = '0x2222222222222222222222222222222222222222';
const env = { WHITECHAIN_NETWORK: 'testnet', CHAIN_ID: '1874', WHITECHAIN_USDT: token, WHITECHAIN_CONFIRMATIONS: '2' };
const input = { payment_tx: `0x${'ab'.repeat(32)}`, amount: '5.00', customer_wallet: from, merchant_wallet: to };
const abi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
function transfer(value = 5_000_000n, address = token, sender = from, recipient = to) {
  return { address, data: encodeAbiParameters([{ type: 'uint256' }], [value]), topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: sender as `0x${string}`, to: recipient as `0x${string}` } }) };
}
beforeEach(() => {
  vi.clearAllMocks(); rpc.getChainId.mockResolvedValue(1874); rpc.readContract.mockResolvedValue(6); rpc.getBlockNumber.mockResolvedValue(11n);
  rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs: [transfer()] });
});
describe('Whitechain USDT receipt verification', () => {
  it('accepts a confirmed transfer with the correct token, sender, recipient and amount', async () => { await expect(verifyWhitechainPayment(input, env)).resolves.toBeUndefined(); });
  it.each([
    ['underpayment', [transfer(1n)]],
    ['unrelated token', [transfer(5_000_000n, from)]],
    ['wrong sender', [transfer(5_000_000n, token, to)]],
    ['wrong recipient', [transfer(5_000_000n, token, from, from)]],
    ['another transaction in the same block', []],
  ])('rejects %s', async (_name, logs) => {
    rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs });
    await expect(verifyWhitechainPayment(input, env)).rejects.toThrow('PAYMENT_UNDERPAID');
  });
  it('rejects a reverted transaction', async () => {
    rpc.getTransactionReceipt.mockResolvedValue({ status: 'reverted', blockNumber: 10n, logs: [transfer()] });
    await expect(verifyWhitechainPayment(input, env)).rejects.toThrow('reverted');
  });
  it('waits for confirmations rather than minting on a pending payment', async () => {
    rpc.getBlockNumber.mockResolvedValue(10n);
    await expect(verifyWhitechainPayment(input, env)).rejects.toThrow('PAYMENT_PENDING');
  });
  it('rejects an RPC on another chain', async () => {
    rpc.getChainId.mockResolvedValue(43113);
    await expect(verifyWhitechainPayment(input, env)).rejects.toThrow('CHAIN_MISMATCH');
  });
  it('does not accept fake payments when the RPC fails', async () => {
    rpc.getTransactionReceipt.mockRejectedValue(new Error('RPC unavailable'));
    await expect(verifyWhitechainPayment(input, env)).rejects.toThrow('RPC unavailable');
  });
  it.each(['0', '-1', '1.0000001', 'NaN'])('rejects invalid amount %s', async (amount) => {
    await expect(verifyWhitechainPayment({ ...input, amount }, env)).rejects.toThrow();
  });
});

describe('payment wallet ownership', () => {
  it('requires a wallet signature and binds it to the specific purchase', async () => {
    const { privateKeyToAccount } = await import('viem/accounts');
    const { paymentAuthorizationMessage, verifyPaymentAuthorization } = await import('./whitechain-payment.js');
    const wallet = privateKeyToAccount(`0x${'01'.repeat(32)}`);
    const context = 'checkout:cs_one';
    const signature = await wallet.signMessage({ message: paymentAuthorizationMessage(context, input.payment_tx, 1874) });
    await expect(verifyPaymentAuthorization({ wallet: wallet.address, signature, context, hash: input.payment_tx }, env)).resolves.toBeUndefined();
    await expect(verifyPaymentAuthorization({ wallet: wallet.address, signature, context: 'checkout:cs_other', hash: input.payment_tx }, env)).rejects.toThrow('PAYMENT_SIGNATURE_INVALID');
    await expect(verifyPaymentAuthorization({ wallet: wallet.address, context, hash: input.payment_tx }, env)).rejects.toThrow('PAYMENT_SIGNATURE_REQUIRED');
  });
});
