import { describe, expect, it } from 'vitest';
import { buildHcsJoin, settleHederaX402 } from './hedera-x402.js';

describe('settleHederaX402', () => {
  it('records provided payment_tx with HashScan URL', async () => {
    const r = await settleHederaX402(
      {
        amount: '1',
        feature: 'ocr',
        holder: '0x1',
        payment_tx: '0.0.1234@1700000000.000000001',
      },
      { HEDERA_NETWORK: 'testnet' },
    );
    expect(r.mode).toBe('provided');
    expect(r.hashscan_url).toContain('hashscan.io/testnet');
    expect(r.payment_tx).toContain('0.0.1234');
  });

  it('demo settles when facilitator unset', async () => {
    const r = await settleHederaX402(
      { amount: '1', feature: 'ocr', holder: '0x1' },
      { HEDERA_DEMO_SETTLE: 'true', HEDERA_NETWORK: 'testnet' },
    );
    expect(r.mode).toBe('demo');
    expect(r.settlement_network).toBe('hedera');
  });

  it('builds HCS join JSON', () => {
    const raw = buildHcsJoin({ payment_tx: 'tx1', grant_id: 'g1', consume_id: 'c1' });
    expect(JSON.parse(raw)).toMatchObject({ payment_tx: 'tx1', grant_id: 'g1', consume_id: 'c1' });
  });
});
