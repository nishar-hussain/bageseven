#!/usr/bin/env node
/**
 * Avalanche registry SDK demo:
 *   plan → checkout confirm → human Guard → agent consume → grant evaporates
 *
 * Requires a running daemon (`pnpm start:local`).
 *   pnpm sdk:demo
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i);
    let v = line.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const base = (process.env.DAEMON_URL ?? 'http://127.0.0.1:4001').replace(/\/$/, '');
const sk = process.env.BAGSEVEN_SECRET_KEY || process.env.DAEMON_AUTH_TOKEN || '';
const pk = process.env.BAGSEVEN_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY || '';
const holder = `sdk-demo-${Date.now()}@bagseven.local`;
const auth = (token) => (token ? { authorization: `Bearer ${token}` } : {});

async function j(method, path, { token, body, daemon } = {}) {
  const headers = {
    ...(daemon && sk ? { authorization: `Bearer ${process.env.DAEMON_AUTH_TOKEN || sk}` } : auth(token)),
    ...(body ? { 'content-type': 'application/json' } : {}),
  };
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

function step(title, detail) {
  console.log(`\n→ ${title}${detail ? `\n  ${detail}` : ''}`);
}

async function main() {
  console.log(`Bagseven SDK demo → ${base}`);
  console.log('plan → checkout → Guard → consume → evaporate\n');

  if (!sk) {
    console.error('Need BAGSEVEN_SECRET_KEY or DAEMON_AUTH_TOKEN in .env');
    process.exit(1);
  }

  step('1. Create thin Plan (sk)');
  const planRes = await j('POST', '/v1/plans', {
    token: sk,
    body: {
      feature: 'ocr',
      name: 'SDK Demo OCR',
      amount: '1.00',
      credits: '2',
      ttl_seconds: 180,
      merchant_wallet: '0x1111111111111111111111111111111111111111',
    },
  });
  if (!planRes.res.ok) {
    console.error('plan failed', planRes.res.status, planRes.json);
    process.exit(1);
  }
  const planId = planRes.json.plan.id;
  console.log(`  plan ${planId}`);

  step('2. Checkout session + public confirm (demo Avalanche tx)');
  const csRes = await j('POST', '/v1/checkout-sessions', {
    token: sk,
    body: { plan_id: planId, holder },
  });
  if (!csRes.res.ok) {
    console.error('checkout session failed', csRes.res.status, csRes.json);
    process.exit(1);
  }
  const cs = csRes.json.session.id;
  console.log(`  session ${cs}`);

  const confirm = await j('POST', `/v1/public/checkout/${cs}/confirm`, {
    body: {
      payment_tx: `0x${'cd'.repeat(32)}`,
      customer_wallet: '0x2222222222222222222222222222222222222222',
    },
  });
  if (!confirm.res.ok) {
    console.error('confirm failed', confirm.res.status, confirm.json);
    process.exit(1);
  }
  console.log(`  PAID grant=${confirm.json.grant.id} remaining=${confirm.json.grant.remaining} mode=${confirm.json.verification}`);

  step('3. Human checkEntitlement (publishable key / FeatureFlagGuard)');
  const check = await j('GET', `/v1/check?feature=ocr&holder=${encodeURIComponent(holder)}`, { token: pk || sk });
  if (!check.res.ok || !check.json.enabled) {
    console.error('human check failed', check.res.status, check.json);
    process.exit(1);
  }
  console.log(`  enabled=${check.json.enabled} remaining=${check.json.remaining}`);

  const identified = await j('POST', '/v1/access-tokens', { token: sk, body: { holder, expiresIn: 900 } });
  if (!identified.res.ok) {
    console.error('identify failed', identified.res.status, identified.json);
    process.exit(1);
  }
  const embed = identified.json.token;

  step('4. Human consume (embed) then agent consume / evaporate');
  const human = await j('POST', '/v1/usage/consume', {
    token: embed,
    body: { feature: 'ocr', amount: '1', idempotencyKey: `demo-human-${Date.now()}` },
  });
  if (!human.res.ok) {
    console.error('human consume failed', human.res.status, human.json);
    process.exit(1);
  }
  console.log(`  human remaining=${human.json.entitlement.remaining}`);

  const agent = await j('POST', '/v1/usage/consume', {
    token: sk,
    body: { feature: 'ocr', holder, amount: '1', idempotencyKey: `demo-agent-${Date.now()}` },
  });
  if (agent.res.ok) {
    console.log(`  agent remaining=${agent.json.entitlement.remaining} dual_gate=${JSON.stringify(agent.json.dual_gate)}`);
  } else {
    console.log(`  dual-gate refused — evaporating via embed`);
    const fallback = await j('POST', '/v1/usage/consume', {
      token: embed,
      body: { feature: 'ocr', amount: '1', idempotencyKey: `demo-evaporate-${Date.now()}` },
    });
    if (!fallback.res.ok) {
      console.error('evaporate failed', fallback.res.status, fallback.json);
      process.exit(1);
    }
  }

  step('5. Grant evaporates');
  const gone = await j('GET', `/v1/check?feature=ocr&holder=${encodeURIComponent(holder)}`, { token: pk || sk });
  console.log(`  enabled=${gone.json.enabled} remaining=${gone.json.remaining}`);
  if (gone.json.enabled || Number(gone.json.remaining) > 0) {
    console.error('expected grant to leave the live surface');
    process.exit(1);
  }
  console.log('\nDEMO_OK — checkout minted the grant; Guard saw it; consume burned it.');
}

main().catch((err) => {
  console.error('DEMO_FAIL', err);
  process.exit(1);
});
