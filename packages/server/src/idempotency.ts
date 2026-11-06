import type { Redis } from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TTL_SECONDS = 86_400; // 24h
const STUCK_MS = 60_000;

export interface IdempotencyState {
  status: 'in_progress' | 'completed';
  statusCode?: number;
  body?: unknown;
  ts: number;
}

/**
 * Idempotency middleware. D5 in docs/DECISIONS.md.
 * - First request: SETNX in_progress; on completion (2xx/4xx) cache the response snapshot.
 * - Retry with same key: in_progress → 409 + Retry-After; completed → stored response verbatim.
 * - 5xx responses are NOT cached, so a failed attempt can be retried with the same key.
 */
export function idempotencyPreHandler(redis: Redis) {
  return async function preHandler(req: FastifyRequest, reply: FastifyReply): Promise<void | FastifyReply> {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method ?? '')) return;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return;

    const cacheKey = `idempotency:${key}`;
    const created = await redis.set(cacheKey, JSON.stringify({ status: 'in_progress', ts: Date.now() } satisfies IdempotencyState), 'EX', TTL_SECONDS, 'NX');
    if (created) return;

    const raw = await redis.get(cacheKey);
    if (!raw) return;
    const state = JSON.parse(raw) as IdempotencyState;
    if (state.status === 'in_progress') {
      reply.header('x-idempotency', 'in_progress');
      return reply.code(409).send({
        error: { code: 'IN_PROGRESS', message: 'request with this idempotency key is already in progress' },
        retry_after: 1,
      });
    }
    return reply.code(state.statusCode ?? 200).send(state.body);
  };
}

export function idempotencyOnSend(redis: Redis) {
  return async function onSend(req: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method ?? '')) return payload;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return payload;
    if (reply.getHeader('x-idempotency') === 'in_progress') return payload;
    if (reply.statusCode >= 500) return payload;

    const cacheKey = `idempotency:${key}`;
    await redis.set(
      cacheKey,
      JSON.stringify({ status: 'completed', statusCode: reply.statusCode, body: payload, ts: Date.now() } satisfies IdempotencyState),
      'EX',
      TTL_SECONDS,
    );
    return payload;
  };
}

/**
 * Resolves idempotency keys stuck in_progress after a crash (STUCK_MS window).
 * Scan-based; runs on an interval owned by the caller.
 */
export async function sweepStuckIdempotency(redis: Redis): Promise<number> {
  let cursor = '0';
  let cleared = 0;
  const now = Date.now();
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'idempotency:*', 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const state = JSON.parse(raw) as IdempotencyState;
        if (state.status === 'in_progress' && now - state.ts > STUCK_MS) {
          await redis.del(key);
          cleared += 1;
        }
      } catch {
        await redis.del(key);
      }
    }
  } while (cursor !== '0');
  return cleared;
}