import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settleWhitechainUsdt, whitechainExplorerUrl } from './whitechain-settle.js';
const verify = vi.hoisted(() => vi.fn());
vi.mock('./whitechain-payment.js', async (original) => ({ ...await original<typeof import('./whitechain-payment.js')>(), verifyWhitechainPayment: verify, verifyPaymentAuthorization: vi.fn(async () => undefined) }));
beforeEach(() => { vi.clearAllMocks(); verify.mockResolvedValue(undefined); });
const input = { amount: '1', feature: 'ocr', holder: 'human', payment_tx: `0x${'ab'.repeat(32)}` };
const recipient = '0x1111111111111111111111111111111111111111';
describe('settleWhitechainUsdt', () => {
  it('never spends a platform private key in provider-funded mode', async () => {
    await expect(settleWhitechainUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { WHITECHAIN_PRIVATE_KEY: `0x${'01'.repeat(32)}`, WHITECHAIN_PAY_TO: recipient })).rejects.toThrow('PROVIDER_CHECKOUT_REQUIRED');
    expect(verify).not.toHaveBeenCalled();
  });
  it('records provided transactions only after real receipt verification', async () => {
    const env = { PROVIDER_FUNDED_GAS: 'false', WHITECHAIN_NETWORK: 'testnet', WHITECHAIN_PAY_TO: recipient };
    const result = await settleWhitechainUsdt(input, env);
    expect(result.mode).toBe('provided'); expect(result.explorer_url).toContain(input.payment_tx);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ payment_tx: input.payment_tx, amount: '1', merchant_wallet: recipient }), env);
  });
  it('does not turn a verification failure into a demo payment', async () => {
    verify.mockRejectedValue(new Error('insufficient transfer'));
    await expect(settleWhitechainUsdt(input, { PROVIDER_FUNDED_GAS: 'false', WHITECHAIN_PAY_TO: recipient })).rejects.toThrow('insufficient transfer');
  });
  it('supports an explicitly enabled development fixture without network calls', async () => {
    const result = await settleWhitechainUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { WHITECHAIN_DEMO_SETTLE: 'true' });
    expect(result.mode).toBe('demo'); expect(verify).not.toHaveBeenCalled();
  });
  it('never enables fake payments in production', async () => {
    await expect(settleWhitechainUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { PROVIDER_FUNDED_GAS: 'false', NODE_ENV: 'production', WHITECHAIN_DEMO_SETTLE: 'true' })).rejects.toThrow('PROVIDER_GAS_REQUIRED');
  });
  it('does not borrow a mandate owner key or send a native stamp as USDT', async () => {
    await expect(settleWhitechainUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { PROVIDER_FUNDED_GAS: 'false', WHITECHAIN_PAY_TO: recipient, DAEMON_OWNER_KEY: `0x${'01'.repeat(32)}` })).rejects.toThrow('WHITECHAIN_PRIVATE_KEY');
  });
  it('builds network-specific explorer URLs', () => {
    expect(whitechainExplorerUrl('0xdead')).toContain('explorer.testnet.whitechain.io/tx/0xdead');
    expect(whitechainExplorerUrl('0xdead', 'mainnet')).toContain('explorer.whitechain.io/tx/0xdead');
  });
});
