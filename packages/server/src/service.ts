import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@bagseven/db';
import { errorResponse } from './errors.js';
import cors from '@fastify/cors';
import { isCorsOriginAllowed } from './cors.js';

export interface ServiceDeps {
  db: Database;
  redis: Redis;
  config: NodeJS.ProcessEnv;
}

export interface CreateServiceOptions {
  name: string;
  port: number;
  host?: string;
  db: Database;
  redis: Redis;
  buildRoutes: (app: FastifyInstance, deps: ServiceDeps) => Promise<void> | void;
  fastifyOptions?: FastifyServerOptions;
}

export async function createService(opts: CreateServiceOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { name: opts.name, level: process.env.LOG_LEVEL ?? 'info' },
    ...opts.fastifyOptions,
  });

  await app.register(cors, {
    origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['mcp-session-id'],
  });

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = errorResponse(err);
    if (status >= 500) {
      app.log.error(err);
    } else if (status >= 400) {
      app.log.warn(
        { status, code: (body as { error?: { code?: string } })?.error?.code, message: (body as { error?: { message?: string } })?.error?.message },
        'request rejected',
      );
    }
    reply.code(status).send(body);
  });

  app.get('/healthz', async () => ({ ok: true, service: opts.name, ts: new Date().toISOString() }));

  await opts.buildRoutes(app, { db: opts.db, redis: opts.redis, config: process.env });

  // Dual stack also accepts Railway's private IPv6 network.
  const host = opts.host ?? process.env.HOST ?? '::';
  await app.listen({ port: opts.port, host });
  app.log.info({ service: opts.name, port: opts.port }, 'listening');
  return app;
}

export { ApiError, errorResponse } from './errors.js';
