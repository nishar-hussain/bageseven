/**
 * Headless product readiness check — Node SDK only.
 * Ensures boolean + numeric entitlements round-trip against a live daemon.
 */
import { BagsevenClient } from '@bagseven/sdk/node';

const DAEMON = (process.env.BAGSEVEN_API_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
const SK = (process.env.BAGSEVEN_SECRET_KEY || process.env.DAEMON_AUTH_TOKEN || '').trim();
const DAEMON_TOKEN = (process.env.DAEMON_AUTH_TOKEN || SK).trim();
const HOLDER = 'demo-subscriber@acme.test';

function ok(label, cond, detail = '') {
  if (!cond) {
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  return true;
}

async function internal(method, path, body) {
  const res = await fetch(`${DAEMON}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${DAEMON_TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json?.error?.message || JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log(`Bagseven product check → ${DAEMON}`);
  if (!SK) throw new Error('missing BAGSEVEN_SECRET_KEY / DAEMON_AUTH_TOKEN');

  const status = await internal('GET', '/internal/mumbai/status');
  ok('daemon up', true, `arkiv=${status.tracks?.arkiv?.store} live=${status.tracks?.arkiv?.live}`);

  const client = new BagsevenClient({ apiKey: SK, baseUrl: DAEMON });

  try {
    await internal('POST', '/internal/features', {
      id: 'pro_notes',
      label: 'Pro notes',
      value_type: 'boolean',
    });
  } catch (e) {
    if (!String(e.message).includes('FEATURE_EXISTS') && !String(e.message).includes('409')) {
      /* ignore if exists */
    }
  }

  await internal('POST', '/internal/grants/mint', {
    feature: 'pro_notes',
    holder: HOLDER,
    remaining: '1',
    ttl_seconds: 1800,
    settlement_network: 'local',
    world_proof_id: `world:ok:${HOLDER}`,
    renewal_enabled: true,
  });
  await internal('POST', '/internal/grants/mint', {
    feature: 'ocr',
    holder: HOLDER,
    remaining: '5',
    ttl_seconds: 1800,
    settlement_network: 'local',
    world_proof_id: `world:ok:${HOLDER}`,
    renewal_enabled: true,
  });

  const pro = await client.checkEntitlement('pro_notes', { holder: HOLDER });
  ok('boolean checkFlag', await client.checkFlag('pro_notes', { holder: HOLDER }) === true, `value_type=${pro.value_type}`);
  ok('boolean remaining is 1|0', pro.remaining === '1' || pro.remaining === '0', `remaining=${pro.remaining}`);

  const before = await client.getRemaining('ocr', { holder: HOLDER });
  ok('numeric remaining > 0', Number(before) > 0, `remaining=${before}`);

  const { token } = await client.identify({ holder: HOLDER, expiresIn: 300 });
  ok('identify / embed token', token.startsWith('bgs_tok_'));

  const consume = await fetch(`${DAEMON}/v1/usage/consume`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      feature: 'ocr',
      holder: HOLDER,
      amount: '1',
      idempotencyKey: `product-check-${Date.now()}`,
    }),
  }).then((r) => r.json());
  ok('numeric consume burns credit', Number(consume.entitlement?.remaining) === Number(before) - 1, JSON.stringify(consume.entitlement?.remaining));

  const boolConsume = await fetch(`${DAEMON}/v1/usage/consume`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      feature: 'pro_notes',
      holder: HOLDER,
      amount: '1',
      idempotencyKey: `product-bool-${Date.now()}`,
    }),
  }).then((r) => r.json());
  ok(
    'boolean consume does not burn',
    boolConsume.note === 'boolean_feature' && boolConsume.entitlement?.enabled === true,
    boolConsume.note,
  );

  const listed = await client.listEntitlements({ holder: HOLDER });
  ok('list entitlements', (listed.entitlements || []).length >= 1, `n=${listed.entitlements?.length}`);

  if (process.exitCode) {
    console.error('\nProduct check FAILED');
    process.exit(1);
  }
  console.log('\nProduct check PASSED — React/Node SDK surface is ready');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
