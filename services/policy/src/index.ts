import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { createService } from '@bagseven/server';
import { buildPolicyRoutes } from './routes.js';

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://bagseven:bagseven@localhost:5432/bagseven',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  await createService({
    name: 'bagseven-policy',
    port: Number(process.env.POLICY_PORT ?? 4003),
    db,
    redis,
    buildRoutes: buildPolicyRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
