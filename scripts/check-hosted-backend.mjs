/** Hosted acceptance checks: no payments, grants or notification emails. */
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';

const env = process.env;
async function check(name, url, options = {}, expected = 200) {
  const response = await globalThis.fetch(url, { ...options, signal: globalThis.AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${name}: HTTP ${response.status}`);
  console.log(`PASS ${name}: HTTP ${response.status}`);
  return body;
}
try {
  for (const key of ['DAEMON_URL', 'GATEWAY_URL', 'BAGSEVEN_MCP_PUBLIC_URL', 'DAEMON_AUTH_TOKEN', 'POLICY_INTERNAL_TOKEN', 'BAGSEVEN_SECRET_KEY']) {
    assert.ok(env[key] && !env[key].includes('REPLACE_'), `${key} must be configured`);
  }
  await check('daemon readiness', `${env.DAEMON_URL}/healthz`);
  await check('gateway readiness', `${env.GATEWAY_URL}/healthz`);
  await check('daemon service authentication', `${env.DAEMON_URL}/internal/grants/live`, {}, 401);
  await check('MCP OAuth required', `${env.BAGSEVEN_MCP_PUBLIC_URL}/mcp`, { headers: { accept: 'application/json, text/event-stream' } }, 401);
  const discovery = await check('MCP OAuth discovery', `${env.BAGSEVEN_MCP_PUBLIC_URL}/.well-known/oauth-authorization-server`);
  assert.equal(discovery.issuer, env.BAGSEVEN_MCP_PUBLIC_URL);
  const plans = await check('billing database read', `${env.DAEMON_URL}/v1/plans`, { headers: { authorization: `Bearer ${env.BAGSEVEN_SECRET_KEY}` } });
  assert.ok(Array.isArray(plans.plans));
  await check('live Arkiv entitlement read', `${env.DAEMON_URL}/internal/grants/live`, { headers: { authorization: `Bearer ${env.DAEMON_AUTH_TOKEN}` } });
  const headers = { authorization: `Bearer ${env.POLICY_INTERNAL_TOKEN}` };
  const mandates = await check('gateway -> policy -> database/cache', `${env.GATEWAY_URL}/v1/mandates?owner_address=0x0000000000000000000000000000000000000001`, { headers });
  assert.ok(Array.isArray(mandates.mandates));
  const config = await check('policy signing identity', `${env.GATEWAY_URL}/v1/mandate-config`, { headers });
  assert.equal(config.operator_address.toLowerCase(), env.DAEMON_EXECUTOR_ADDRESS.toLowerCase());
  const world = await check('World session challenge', `${env.DAEMON_URL}/internal/world/rp-signature`, {
    method: 'POST', headers: { authorization: `Bearer ${env.DAEMON_AUTH_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'session' }),
  });
  assert.equal(world.rp_id, env.WORLD_RP_ID);
  if (env.NEXT_PUBLIC_CONSOLE_URL) {
    const config = await check('dashboard World login readiness', `${env.NEXT_PUBLIC_CONSOLE_URL}/api/auth/world`);
    assert.equal(config.idkit, true);
    assert.equal(config.signing_configured, true);
    assert.equal(config.mock_proofs, false);
    assert.equal(config.app_id, env.WORLD_APP_ID);
    await check('dashboard -> daemon World challenge', `${env.NEXT_PUBLIC_CONSOLE_URL}/api/auth/world/challenge`, { method: 'POST', headers: { origin: env.NEXT_PUBLIC_CONSOLE_URL } });
  }
  console.log('HOSTED_BACKEND_CHECKS_OK. World consent, provider funding and customer checkout remain separate human/wallet steps.');
} catch (error) {
  console.error(`Hosted check failed: ${error.message}`);
  process.exitCode = 1;
}
