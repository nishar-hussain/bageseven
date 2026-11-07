// Local packaging/integration test: isolated disposable DB/cache, no host ports,
// no production credentials and no external network or blockchain transactions.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const image = process.argv[2] || 'bagseven-backend:railway-check';
const prefix = `bagseven-check-${process.pid}`;
const containers = [];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
const run = (name, args) => {
  const full = `${prefix}-${name}`;
  containers.push(full);
  docker('run', '-d', '--name', full, '--network', prefix, ...args);
  return full;
};
const token = randomBytes(32).toString('hex');
const env = {
  NODE_ENV: 'production', HOST: '::',
  DATABASE_URL: `postgres://bagseven:test-only@${prefix}-db:5432/bagseven`,
  REDIS_URL: `redis://${prefix}-cache:6379`,
  DAEMON_AUTH_TOKEN: token, POLICY_INTERNAL_TOKEN: token, GATEWAY_AUTH_TOKEN: token,
  AUTH_SECRET: randomBytes(32).toString('hex'), RESEND_API_KEY: 'test-no-mail',
  PROVIDER_FUNDED_GAS: 'true', PROVIDER_GAS_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  ENTITLEMENT_STORE: 'arkiv', ARKIV_ACCESS_KEY: 'test-no-chain-access',
  WORLD_MOCK_PROOFS: 'false', WHITECHAIN_DEMO_SETTLE: 'false',
  DAEMON_URL: `http://${prefix}-daemon:4001`, POLICY_URL: `http://${prefix}-policy:4003`,
  BAGSEVEN_MCP_WORKER: '00000000-0000-4000-8000-000000000001',
  BAGSEVEN_MCP_PUBLIC_URL: 'https://bagseven.invalid', MCP_OAUTH_REQUIRED: 'true',
  BAGSEVEN_SECRET_KEY: `sk_test_${token}`,
};
const variables = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
try {
  docker('network', 'create', '--internal', prefix);
  const db = run('db', ['-e', 'POSTGRES_USER=bagseven', '-e', 'POSTGRES_PASSWORD=test-only', '-e', 'POSTGRES_DB=bagseven', 'postgres:17']);
  run('cache', ['valkey/valkey:8']);
  for (let attempt = 0; ; attempt++) {
    try { docker('exec', db, 'pg_isready', '-U', 'bagseven'); break; }
    catch { if (attempt === 30) throw new Error('Disposable Postgres did not become ready'); await setTimeout(1000); }
  }
  docker('run', '--rm', '--network', prefix, ...variables, image, 'pnpm', 'db:migrate');
  console.log('PASS clean production database migrations');
  for (const [name, port] of Object.entries({ daemon: 4001, policy: 4003, gateway: 4000, mcp: 4009 })) {
    run(name, [...variables, '-e', `PORT=${port}`, image, 'node', ...(name === 'mcp' ? ['--import', 'tsx', 'scripts/bagseven-mcp.ts'] : [`services/${name}/dist/index.js`])]);
  }
  run('combined', [...variables, '-e', 'PORT=4009', '-e', 'BAGSEVEN_MCP_EMBEDDED=true', image, 'node', 'scripts/start-daemon.mjs']);
  const checks = `
    import assert from 'node:assert/strict';
    const base = name => 'http://${prefix}-'+name+':'+({daemon:4001,policy:4003,gateway:4000,mcp:4009})[name];
    for (const name of ['daemon','policy','gateway','mcp']) {
      for (let attempt=0;;attempt++) {
        try { const r=await fetch(base(name)+'/healthz'); assert.equal(r.status,200); assert.equal((await r.json()).ok,true); break; }
        catch(e) { if(attempt===30) throw e; await new Promise(r=>setTimeout(r,1000)); }
      }
      console.log('PASS '+name+' production startup and PORT/healthz');
    }
    const path='/v1/mandates?owner_address=0x0000000000000000000000000000000000000001';
    const r=await fetch(base('gateway')+path,{headers:{authorization:'Bearer '+process.env.POLICY_INTERNAL_TOKEN}});
    assert.equal(r.status,200); assert.deepEqual((await r.json()).mandates,[]);
    console.log('PASS authenticated gateway -> private policy -> migrated Postgres');
    assert.equal((await fetch(base('daemon')+'/internal/grants/live')).status,401);
    assert.equal((await fetch(base('mcp')+'/mcp',{headers:{accept:'application/json, text/event-stream'}})).status,401);
    const discovery=await fetch(base('mcp')+'/.well-known/oauth-authorization-server');
    assert.equal(discovery.status,200);
    console.log('PASS daemon authentication, MCP OAuth gate and discovery');
    const combined='http://${prefix}-combined:4009';
    for(let attempt=0;;attempt++) {
      try { assert.equal((await fetch(combined+'/healthz')).status,200); break; }
      catch(e) { if(attempt===30) throw e; await new Promise(r=>setTimeout(r,1000)); }
    }
    assert.equal((await fetch(combined+'/internal/grants/live')).status,401);
    assert.equal((await fetch(combined+'/mcp',{headers:{accept:'application/json, text/event-stream'}})).status,401);
    const plans=await fetch(combined+'/v1/plans',{headers:{authorization:'Bearer '+process.env.BAGSEVEN_SECRET_KEY}});
    assert.equal(plans.status,200); assert.deepEqual((await plans.json()).plans,[]);
    assert.equal((await fetch(combined+'/.well-known/oauth-authorization-server')).status,200);
    console.log('PASS shared daemon/MCP: readiness, both auth gates, OAuth and authenticated database-backed API');
  `;
  console.log(docker('run', '--rm', '--network', prefix, ...variables, image, 'node', '--input-type=module', '-e', checks).trim());
  const columns = docker('exec', db, 'psql', '-U', 'bagseven', '-Atc', "SELECT column_name FROM information_schema.columns WHERE table_name='provider_gas_accounts'");
  assert.ok(columns.includes('encrypted_key'), 'provider gas migration must be present');
  console.log('PASS provider gas schema installed; no real payments or human login performed');
} catch (error) {
  // Do not print the Docker invocation: its arguments include ephemeral tokens.
  console.error('Railway image smoke check failed:', error.stderr?.toString() || error.code || 'container check failed');
  process.exitCode = 1;
} finally {
  for (const name of containers.reverse()) { try { docker('rm', '-fv', name); } catch { /* Already removed. */ } }
  try { docker('network', 'rm', prefix); } catch { /* Not created. */ }
}
