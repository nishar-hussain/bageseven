import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineRailway, github, postgres, project, redis, service, volume } from 'railway/iac';

// One project, four independently supervised processes, one shared database/cache.
// Credentials are references to Railway shared variables, never checked-in values.
export default defineRailway((ctx) => {
  const database = postgres('Postgres');
  const cache = redis('Redis');
  const data = volume('daemon-data', { sizeMB: 1024 });
  const ports = { daemon: 4001, gateway: 4000, policy: 4003, mcp: 4009 };
  const services = Object.entries(ports).map(([name, port]) => {
    const template = parseEnv(readFileSync(new URL(`../deploy/railway/${name}.env.example`, import.meta.url), 'utf8'));
    const env = Object.fromEntries(Object.keys(template).map(key => [key, ctx.shared[key]]));
    Object.assign(env, { NODE_ENV: 'production', HOST: '::', PORT: String(port) });
    if (name !== 'mcp') Object.assign(env, { DATABASE_URL: database.env.DATABASE_URL, REDIS_URL: cache.env.REDIS_URL });
    if (name === 'daemon' || name === 'gateway') env.POLICY_URL = 'http://${{policy.RAILWAY_PRIVATE_DOMAIN}}:4003';
    if (name === 'daemon') env.BAGSEVEN_DATA_DIR = '/data';
    if (name === 'mcp') env.DAEMON_URL = 'http://${{daemon.RAILWAY_PRIVATE_DOMAIN}}:4001';

    return service(name, {
      source: github('nishar-hussain/bageseven', { branch: 'main', rootDirectory: '/' }),
      build: { builder: 'DOCKERFILE', dockerfilePath: 'deploy/Dockerfile.backend' },
      start: name === 'mcp' ? 'node --import tsx scripts/bagseven-mcp.ts' : `node services/${name}/dist/index.js`,
      ...(name === 'daemon' ? { preDeploy: 'pnpm db:migrate', volumeMounts: { '/data': data } } : {}),
      healthcheck: '/healthz',
      healthcheckTimeout: 120,
      replicas: 1,
      deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10, sleepApplication: false },
      env,
    });
  });
  return project(ctx.projectName || 'bagseven', { resources: [database, cache, data, ...services] });
});
