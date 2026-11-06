import { createHash, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ApiError } from '@bagseven/server';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
/** Durable idempotency: uncertain payment attempts are held for reconciliation, never automatically resent. */
export async function beginWorkerRequest(redis: Redis, worker: string, body: { idempotency_key?: string; [key: string]: unknown }) {
  const key = body.idempotency_key ? `worker-fetch:${worker}:${body.idempotency_key}` : undefined;
  const fingerprint = createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
  const owner = randomUUID();
  let guarded = false;
  if (key) {
    const fresh = await redis.set(key, JSON.stringify({ owner, fingerprint, phase: 'pending' }), 'NX');
    if (!fresh) {
      const prior = JSON.parse((await redis.get(key)) || '{}');
      if (prior.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for different payment inputs');
      if (prior.phase === 'complete') return { replay: true, result: prior.result, checkpoint: async () => {}, complete: async (_result: unknown) => {}, fail: async () => {} };
      throw new ApiError(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'This request is in progress or needs reconciliation; do not resend the payment');
    }
  }
  async function write(phase: string, result?: unknown) {
    if (key) await redis.set(key, JSON.stringify({ owner, fingerprint, phase, result }));
  }
  return {
    replay: false, result: undefined,
    checkpoint: async () => { guarded = true; await write('payment_attempted'); },
    complete: async (result: unknown) => write('complete', result),
    fail: async () => {
      if (key && !guarded) await redis.eval('local value = redis.call("get", KEYS[1]); if value and cjson.decode(value).owner == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, key, owner);
    },
  };
}
