import { describe, expect, it, vi } from 'vitest';
import { claimSettlement } from './payment-ledger.js';
const settlement = { payment_tx: `0x${'ab'.repeat(32)}`, settlement_network: 'avalanche' as const, network: 'testnet' as const, explorer_url: 'https://testnet.snowtrace.io', mode: 'provided' as const };
describe('shared payment receipt ledger', () => {
  it('refuses duplicate receipts on credit and mint paths', async () => {
    const claimPayment = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(claimSettlement(settlement, { claimPayment })).resolves.toBeUndefined();
    await expect(claimSettlement(settlement, { claimPayment })).rejects.toMatchObject({ code: 'PAYMENT_REUSED' });
  });
  it('fails closed when the persistent ledger is unavailable', async () => {
    await expect(claimSettlement(settlement, {})).rejects.toThrow('Payment replay protection');
  });
});
