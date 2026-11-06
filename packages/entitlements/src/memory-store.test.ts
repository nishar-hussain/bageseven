import { describe, expect, it } from 'vitest';
import { MemoryGrantStore } from './memory-store.js';

describe('MemoryGrantStore', () => {
  it('mints a live grant and refuses World deny', async () => {
    const store = new MemoryGrantStore();
    await expect(store.mint({
      feature: 'ocr',
      holder: '0xabc',
      remaining: '5',
      ttl_seconds: 60,
      world_denied: true,
    })).rejects.toThrow(/WORLD_DENIED/);

    const grant = await store.mint({
      feature: 'ocr',
      holder: '0xabc',
      remaining: '5',
      ttl_seconds: 120,
      settlement_network: 'hedera',
      payment_tx: '0xpay',
    });
    expect(grant.remaining).toBe('5');
    expect(grant.renewal_enabled).toBe(true);
    const live = await store.findLive({ holder: '0xabc', feature: 'ocr' });
    expect(live).toHaveLength(1);
  });

  it('consumes idempotently and supports cancel without killing access', async () => {
    const store = new MemoryGrantStore();
    const grant = await store.mint({ feature: 'ocr', holder: '0x1', remaining: '3', ttl_seconds: 300 });
    const once = await store.consume(grant.id, '1', 'k1');
    const again = await store.consume(grant.id, '1', 'k1');
    expect(once.remaining).toBe('2');
    expect(again.remaining).toBe('2');
    const cancelled = await store.cancelRenewal(grant.id);
    expect(cancelled.renewal_enabled).toBe(false);
    const still = await store.findLive({ holder: '0x1' });
    expect(still).toHaveLength(1);
  });

  it('evaporates from findLive after TTL', async () => {
    const store = new MemoryGrantStore();
    const grant = await store.mint({ feature: 'ocr', holder: '0x2', remaining: '1', ttl_seconds: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    const live = await store.findLive({ holder: '0x2' });
    expect(live).toHaveLength(0);
    await expect(store.consume(grant.id, '1', 'late')).rejects.toThrow(/GRANT_EXPIRED/);
  });
});
