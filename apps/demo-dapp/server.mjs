/**
 * Merchant backend for the demo dapp.
 * Uses @bagseven/sdk/node (secret key) — never ship this key to the browser.
 */
import { createServer } from 'node:http';
import { BagsevenClient } from '@bagseven/sdk/node';

const PORT = Number(process.env.DEMO_DAPP_API_PORT || 5178);
const DAEMON = (process.env.BAGSEVEN_API_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
const SK = (process.env.BAGSEVEN_SECRET_KEY || process.env.DAEMON_AUTH_TOKEN || '').trim();
const PK = (process.env.BAGSEVEN_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY || '').trim();
const DAEMON_TOKEN = (process.env.DAEMON_AUTH_TOKEN || SK).trim();
const HOLDER = (process.env.DEMO_HOLDER || 'demo-subscriber@acme.test').trim();
const FEATURE_PRO = 'pro_notes';
const FEATURE_OCR = 'ocr';

if (!SK) {
  console.error('[demo-api] BAGSEVEN_SECRET_KEY or DAEMON_AUTH_TOKEN required');
  process.exit(1);
}

const client = new BagsevenClient({ apiKey: SK, baseUrl: DAEMON });

async function daemonInternal(method, path, body) {
  const res = await fetch(`${DAEMON}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${DAEMON_TOKEN}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `daemon ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function ensureFeature(id, valueType, label) {
  const list = await daemonInternal('GET', '/internal/features');
  if ((list.features || []).some((f) => f.id === id)) return;
  try {
    await daemonInternal('POST', '/internal/features', {
      id,
      label,
      value_type: valueType,
      blurb: valueType === 'boolean' ? 'Demo boolean subscription flag' : 'Demo metered credits',
    });
  } catch (e) {
    if (!String(e.message).includes('FEATURE_EXISTS') && e.status !== 409) throw e;
  }
}

async function ensureEntitlement(feature, remaining = '10') {
  const check = await client.checkEntitlement(feature, { holder: HOLDER });
  if (check.enabled) return check;
  const valueType = check.value_type || (feature === FEATURE_PRO ? 'boolean' : 'numeric');
  await daemonInternal('POST', '/internal/grants/mint', {
    feature,
    holder: HOLDER,
    remaining: valueType === 'boolean' ? '1' : remaining,
    ttl_seconds: 3600,
    settlement_network: 'local',
    world_proof_id: `world:ok:${HOLDER}`,
    renewal_enabled: true,
  });
  return client.checkEntitlement(feature, { holder: HOLDER });
}

async function bootstrap() {
  await ensureFeature(FEATURE_PRO, 'boolean', 'Pro notes');
  await ensureFeature(FEATURE_OCR, 'numeric', 'OCR');
  const pro = await ensureEntitlement(FEATURE_PRO, '1');
  const ocr = await ensureEntitlement(FEATURE_OCR, '8');
  const identified = await client.identify({ holder: HOLDER, expiresIn: 1800 });
  return {
    holder: HOLDER,
    publishableKey: PK || 'pk_local',
    accessToken: identified.token,
    entitlements: { pro, ocr },
    apiUrl: '/v1',
  };
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/demo/bootstrap') {
      send(res, 200, await bootstrap());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/demo/check') {
      const feature = url.searchParams.get('feature') || FEATURE_PRO;
      const ent = await client.checkEntitlement(feature, { holder: HOLDER });
      const flag = await client.checkFlag(feature, { holder: HOLDER });
      const remaining = await client.getRemaining(feature, { holder: HOLDER });
      send(res, 200, { feature, flag, remaining, entitlement: ent, via: '@bagseven/sdk/node' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/demo/consume') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const feature = body.feature || FEATURE_OCR;
      const amount = body.amount || '1';
      // Secret-key consume hits dual-gate for agents; use embed-scoped path via identify token instead.
      const { token } = await client.identify({ holder: HOLDER, expiresIn: 300 });
      const r = await fetch(`${DAEMON}/v1/usage/consume`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          feature,
          holder: HOLDER,
          amount,
          idempotencyKey: `demo-${feature}-${Date.now()}`,
        }),
      });
      const json = await r.json();
      if (!r.ok) {
        send(res, r.status, json);
        return;
      }
      send(res, 200, { ...json, via: '@bagseven/sdk/node + embed consume' });
      return;
    }
    send(res, 404, { error: { message: 'not found' } });
  } catch (e) {
    send(res, e.status || 500, {
      error: { message: e instanceof Error ? e.message : String(e), body: e.body },
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo-api] http://127.0.0.1:${PORT}  holder=${HOLDER}  daemon=${DAEMON}`);
});
