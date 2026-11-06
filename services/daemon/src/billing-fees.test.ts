import { describe, expect, it } from 'vitest';
import { MemoryBillingStore, platformFee } from './billing-store.js';

describe('provider transaction fees', () => {
  it('calculates exactly 0.1%, including fractional micro-USDT and large amounts', () => {
    expect(platformFee('100')).toBe('0.1');
    expect(platformFee('5')).toBe('0.005');
    expect(platformFee('0.000001')).toBe('0.000000001');
    expect(platformFee('9007199254740993')).toBe('9007199254740.993');
    expect(() => platformFee('1.0000001')).toThrow();
  });

  it('records one fee on a paid checkout while the provider receives the full price', () => {
    const store = new MemoryBillingStore();
    const plan = store.createPlan({ name: 'Provider plan', feature: 'ocr', amount: '100', merchant_wallet: '0x3333333333333333333333333333333333333333' });
    const session = store.createCheckout({ plan_id: plan.id, holder: 'customer' });
    expect(session.amount).toBe('100');
    expect(session.platform_fee_amount).toBe('0.1');
    expect(session.platform_fee_bps).toBe(10);
    expect(session.plan?.merchant_wallet).toBe(plan.merchant_wallet);
    expect(store.listCheckouts().filter(s => s.status === 'PAID')).toHaveLength(0);
    const payment = { payment_tx: `0x${'a'.repeat(64)}`, customer_wallet: '0x4444444444444444444444444444444444444444', grant_id: 'grant-1' };
    store.markPaid(session.id, payment);
    store.markPaid(session.id, payment);
    const accrued = store.listCheckouts().filter(s => s.status === 'PAID');
    expect(accrued).toHaveLength(1);
    expect(accrued[0].platform_fee_amount).toBe('0.1');
  });
});
