import type { Redis } from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Token-bucket rate limiting, per agent (or per key when no agent header).
 * Lua ensures the check-and-decrement is atomic under concurrency.
 */
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
end
if current > limit then
  return {0, current}
end
return {1, current}
`;

export function rateLimit(redis: Redis, opts: { limit?: number; windowSeconds?: number } = {}) {
  const limit = opts.limit ?? 50;
  const windowSeconds = opts.windowSeconds ?? 1;
  return async function preHandler(req: FastifyRequest, reply: FastifyReply): Promise<void | FastifyReply> {
    const agentId = (req as FastifyRequest & { agent?: { id: string } }).agent?.id;
    const scope = agentId ? `agent:${agentId}` : `ip:${req.ip}`;
    const key = `ratelimit:${scope}`;
    const [allowed] = (await redis.eval(
      RATE_LIMIT_LUA,
      1,
      key,
      String(limit),
      String(windowSeconds),
      String(Math.floor(Date.now() / 1000)),
    )) as [number, number];
    reply.header('x-ratelimit-scope', scope);
    if (allowed === 0) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'rate limit exceeded' },
        retry_after: windowSeconds,
        limit_scope: scope,
      });
    }
  };
}