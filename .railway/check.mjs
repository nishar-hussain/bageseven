import assert from 'node:assert/strict';
import console from 'node:console';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parseEnv } from 'node:util';
import { createRailwayContext } from 'railway/iac';
import program from './railway.ts';

const configuration = await program(createRailwayContext({ environment: 'production' }));
const resources = new Map(configuration.resources.map(resource => [resource.name, resource]));
assert.equal(resources.size, 7);
assert.equal(resources.get('Postgres').engine, 'postgres');
assert.equal(resources.get('Redis').engine, 'redis');
assert.equal(resources.get('daemon-data').type, 'volume');
const sharedKeys = new Set();
for (const name of ['daemon', 'gateway', 'policy', 'mcp']) {
  const service = resources.get(name);
  assert.equal(service.build.dockerfilePath, 'deploy/Dockerfile.backend');
  assert.equal(service.source.rootDirectory, '/');
  assert.equal(service.deploy.healthcheckPath, '/healthz');
  assert.equal(service.deploy.numReplicas, 1);
  assert.equal(service.deploy.sleepApplication, false);
  for (const value of Object.values(service.variables)) {
    if (value.type === 'sharedReference') sharedKeys.add(value.name);
    else if (value.type === 'literal') assert.ok(!value.value?.includes('REPLACE_'));
  }
  if (name !== 'daemon') assert.ok(!service.deploy.preDeployCommand);
  if (name !== 'mcp') {
    assert.equal(service.variables.DATABASE_URL.resource, 'database.Postgres');
    assert.equal(service.variables.REDIS_URL.resource, 'database.Redis');
  }
}
assert.deepEqual(resources.get('daemon').deploy.preDeployCommand, ['pnpm db:migrate']);
assert.ok(JSON.stringify(resources.get('daemon').volumeAttachments).includes('/data'));
for (const name of ['gateway', 'daemon']) assert.ok(resources.get(name).variables.POLICY_URL.value.includes('policy.RAILWAY_PRIVATE_DOMAIN'));
assert.ok(resources.get('mcp').variables.DAEMON_URL.value.includes('daemon.RAILWAY_PRIVATE_DOMAIN'));
const sharedPath = new URL('./.env.prod', import.meta.url);
if (existsSync(sharedPath)) {
  const shared = parseEnv(readFileSync(sharedPath, 'utf8'));
  assert.deepEqual([...sharedKeys].filter(key => !(key in shared)), [], 'Run pnpm setup:prod to refresh missing shared variables');
}
console.log('Railway configuration OK: four services, managed Postgres/Redis, daemon volume, private URLs, migration owner and shared-variable names.');
console.log('This validates repository configuration, not credentials or the deployed Railway project.');
