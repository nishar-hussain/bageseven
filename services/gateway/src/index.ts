import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { ApiError, rateLimit, createService } from '@bagseven/server';
import cors from '@fastify/cors';

async function proxy(req: FastifyRequest, reply: FastifyReply, cfg: NodeJS.ProcessEnv): Promise<unknown> {
  const baseUrl = cfg.MANDATE_URL ?? cfg.POLICY_URL;
  if (!baseUrl) throw new Error('MANDATE_URL not configured');
  const body = req.body === undefined ? undefined : JSON.stringify(req.body);
  const headers: Record<string, string> = {
    'x-trace-id': (req.headers['x-trace-id'] as string) ?? randomUUID(),
  };
  if (typeof req.headers['content-type'] === 'string') headers['content-type'] = req.headers['content-type'];
  if (typeof req.headers['idempotency-key'] === 'string') headers['idempotency-key'] = req.headers['idempotency-key'];

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${req.url}`, { method: req.method, headers, body });
  } catch (error) {
    throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', `policy service is unreachable at ${baseUrl}: ${(error as Error).message}`);
  }
  const text = await res.text();
  const payload = text ? JSON.parse(text) : undefined;
  reply.code(res.status);
  return payload;
}

export function buildGatewayRoutes(app: FastifyInstance, { redis, config }: { db: ReturnType<typeof createDb>; redis: Redis; config: NodeJS.ProcessEnv }): void {
  void app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : (config.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.addHook('preHandler', rateLimit(redis, { limit: Number(config.RATE_LIMIT_PER_AGENT ?? 50), windowSeconds: 1 }));

  app.all('/v1/*', async (req, reply) => proxy(req, reply, config));
}

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://bagseven:bagseven@localhost:5432/bagseven',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  await createService({
    name: 'bagseven-gateway',
    port: Number(process.env.GATEWAY_PORT ?? 4000),
    db,
    redis,
    buildRoutes: (app, deps) => buildGatewayRoutes(app, { db, redis, config: deps.config }),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
