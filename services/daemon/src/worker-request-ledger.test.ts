import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { beginWorkerRequest } from './worker-request-ledger.js';
function redis() {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string, nx?: string) => { if (nx === 'NX' && values.has(key)) return null; values.set(key, value); return 'OK'; },
    eval: async (_script: string, _keys: number, key: string, owner: string) => { const value = values.get(key); if (value && JSON.parse(value).owner === owner) values.delete(key); return 1; },
  } as unknown as Redis;
}
describe('worker payment retries', () => {
  it('returns the completed payment instead of sending it again', async () => {
    const db = redis(); const input = { amount: '0.01', recipient: 'provider', idempotency_key: 'purchase' };
    const first = await beginWorkerRequest(db, 'worker', input);
    await first.checkpoint(); await first.complete({ tx_hash: 'confirmed', decision: 'allow' });
    const retry = await beginWorkerRequest(db, 'worker', { idempotency_key: 'purchase', recipient: 'provider', amount: '0.01' });
    expect(retry.replay).toBe(true); expect(retry.result).toEqual({ tx_hash: 'confirmed', decision: 'allow' });
    await expect(beginWorkerRequest(db, 'worker', { ...input, amount: '0.02' })).rejects.toThrow('different payment inputs');
  });
  it('holds uncertain attempted payments for reconciliation', async () => {
    const db = redis(); const input = { idempotency_key: 'uncertain' };
    const first = await beginWorkerRequest(db, 'worker', input); await first.checkpoint(); await first.fail();
    await expect(beginWorkerRequest(db, 'worker', input)).rejects.toThrow('reconciliation');
  });
  it('releases a failed preflight that could not have moved funds', async () => {
    const db = redis(); const input = { idempotency_key: 'preflight' };
    const first = await beginWorkerRequest(db, 'worker', input); await first.fail();
    expect((await beginWorkerRequest(db, 'worker', input)).replay).toBe(false);
  });
});
