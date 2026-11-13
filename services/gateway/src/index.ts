import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { ApiError, rateLimit, createService } from '@bagseven/server';

function gatewayToken(cfg: NodeJS.ProcessEnv): string | undefined {
  return cfg.GATEWAY_AUTH_TOKEN?.trim() || cfg.POLICY_INTERNAL_TOKEN?.trim() || undefined;
}

function bearerMatches(header: string | string[] | undefined, expected: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const got = header.slice('Bearer '.length).trim();
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertGatewayAuth(req: FastifyRequest, cfg: NodeJS.ProcessEnv): void {
  if ((cfg.GATEWAY_ALLOW_UNAUTHENTICATED ?? '').toLowerCase() === 'true') {
    if (cfg.NODE_ENV === 'production') {
      throw new ApiError(503, 'MISCONFIGURED', 'GATEWAY_ALLOW_UNAUTHENTICATED is forbidden in production');
    }
    return;
  }
  const token = gatewayToken(cfg);
  if (!token) {
    throw new ApiError(503, 'MISCONFIGURED', 'Set GATEWAY_AUTH_TOKEN or POLICY_INTERNAL_TOKEN to authenticate the gateway');
  }
  if (!bearerMatches(req.headers.authorization, token)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'gateway authentication required');
  }
}

async function proxy(req: FastifyRequest, reply: FastifyReply, cfg: NodeJS.ProcessEnv): Promise<unknown> {
  assertGatewayAuth(req, cfg);
  const baseUrl = cfg.MANDATE_URL ?? cfg.POLICY_URL;
  if (!baseUrl) throw new Error('MANDATE_URL not configured');
  const body = req.body === undefined ? undefined : JSON.stringify(req.body);
  const headers: Record<string, string> = {
    'x-trace-id': (req.headers['x-trace-id'] as string) ?? randomUUID(),
  };
  if (typeof req.headers['content-type'] === 'string') headers['content-type'] = req.headers['content-type'];
  if (typeof req.headers['idempotency-key'] === 'string') headers['idempotency-key'] = req.headers['idempotency-key'];
  // Forward the same service token to policy (vault/internal routes require it).
  const token = gatewayToken(cfg);
  if (token) headers.authorization = `Bearer ${token}`;
  // Never forward browser actor headers as authoritative to policy from the open internet —
  // only the authenticated console BFF should set these after session checks.
  if (typeof req.headers['x-bagseven-actor'] === 'string') headers['x-bagseven-actor'] = req.headers['x-bagseven-actor'];
  for (const name of ['x-bagseven-provider', 'x-bagseven-provider-scope']) {
    if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
  }

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
    port: Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 4000),
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
