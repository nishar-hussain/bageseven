import { describe, expect, it } from 'vitest';
import { settleWhitechainUsdt, whitechainExplorerUrl } from './whitechain-settle.js';

describe('settleWhitechainUsdt', () => {
  it('records provided payment_tx with explorer URL', async () => {
    const r = await settleWhitechainUsdt(
      {
        amount: '1',
        feature: 'ocr',
        holder: '0x1',
        payment_tx: '0xabc123',
      },
      { WHITECHAIN_NETWORK: 'testnet' },
    );
    expect(r.mode).toBe('provided');
    expect(r.settlement_network).toBe('whitechain');
    expect(r.explorer_url).toContain('explorer.testnet.whitechain.io/tx/0xabc123');
  });

  it('demo settles when operator unset', async () => {
    const r = await settleWhitechainUsdt(
      { amount: '1', feature: 'ocr', holder: '0x1' },
      { WHITECHAIN_DEMO_SETTLE: 'true' },
    );
    expect(r.mode).toBe('demo');
    expect(r.payment_tx.startsWith('0x')).toBe(true);
  });

  it('builds explorer URLs', () => {
    expect(whitechainExplorerUrl('0xdead')).toContain('/tx/0xdead');
  });
});
