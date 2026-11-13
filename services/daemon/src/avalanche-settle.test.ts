import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settleAvalancheUsdt, avalancheExplorerUrl } from './avalanche-settle.js';
const verify = vi.hoisted(() => vi.fn());
vi.mock('./avalanche-payment.js', async (original) => ({ ...await original<typeof import('./avalanche-payment.js')>(), verifyAvalanchePayment: verify, verifyPaymentAuthorization: vi.fn(async () => undefined) }));
beforeEach(() => { vi.clearAllMocks(); verify.mockResolvedValue(undefined); });
const input = { amount: '1', feature: 'ocr', holder: 'human', payment_tx: `0x${'ab'.repeat(32)}` };
const recipient = '0x1111111111111111111111111111111111111111';
describe('settleAvalancheUsdt', () => {
  it('never spends a platform private key in provider-funded mode', async () => {
    await expect(settleAvalancheUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { AVALANCHE_PRIVATE_KEY: `0x${'01'.repeat(32)}`, AVALANCHE_PAY_TO: recipient })).rejects.toThrow('PROVIDER_CHECKOUT_REQUIRED');
    expect(verify).not.toHaveBeenCalled();
  });
  it('records provided transactions only after real receipt verification', async () => {
    const env = { PROVIDER_FUNDED_GAS: 'false', AVALANCHE_NETWORK: 'testnet', AVALANCHE_PAY_TO: recipient };
    const result = await settleAvalancheUsdt(input, env);
    expect(result.mode).toBe('provided'); expect(result.explorer_url).toContain(input.payment_tx);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ payment_tx: input.payment_tx, amount: '1', merchant_wallet: recipient }), env);
  });
  it('does not turn a verification failure into a demo payment', async () => {
    verify.mockRejectedValue(new Error('insufficient transfer'));
    await expect(settleAvalancheUsdt(input, { PROVIDER_FUNDED_GAS: 'false', AVALANCHE_PAY_TO: recipient })).rejects.toThrow('insufficient transfer');
  });
  it('supports an explicitly enabled development fixture without network calls', async () => {
    const result = await settleAvalancheUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { AVALANCHE_DEMO_SETTLE: 'true' });
    expect(result.mode).toBe('demo'); expect(verify).not.toHaveBeenCalled();
  });
  it('never enables fake payments in production', async () => {
    await expect(settleAvalancheUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { PROVIDER_FUNDED_GAS: 'false', NODE_ENV: 'production', AVALANCHE_DEMO_SETTLE: 'true' })).rejects.toThrow('PROVIDER_GAS_REQUIRED');
  });
  it('does not borrow a mandate owner key or send a native stamp as USDT', async () => {
    await expect(settleAvalancheUsdt({ amount: '1', feature: 'ocr', holder: 'human' }, { PROVIDER_FUNDED_GAS: 'false', AVALANCHE_PAY_TO: recipient, DAEMON_OWNER_KEY: `0x${'01'.repeat(32)}` })).rejects.toThrow('AVALANCHE_PRIVATE_KEY');
  });
  it('builds network-specific explorer URLs', () => {
    expect(avalancheExplorerUrl('0xdead')).toContain('testnet.snowtrace.io/tx/0xdead');
    expect(avalancheExplorerUrl('0xdead', 'mainnet')).toContain('snowtrace.io/tx/0xdead');
  });
});
