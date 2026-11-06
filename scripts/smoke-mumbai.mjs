#!/usr/bin/env node
/**
 * Smoke against daemon (memory + demo settle).
 * Usage: pnpm smoke
 * Requires daemon on DAEMON_URL (default http://127.0.0.1:4001).
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
const auth = process.env.DAEMON_AUTH_TOKEN
  ? { authorization: `Bearer ${process.env.DAEMON_AUTH_TOKEN}` }
  : {};

async function j(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log(`smoke → ${base}`);
  const status = await j('GET', '/internal/mumbai/status');
  console.log('status', JSON.stringify(status.tracks));

  const mint = await j('POST', '/internal/grants/mint', {
    feature: 'ocr',
    holder: 'smoke-human',
    remaining: '3',
    ttl_seconds: 90,
    settlement_network: 'hedera',
    world_proof_id: 'world:ok:smoke-human',
    renewal_enabled: true,
  });
  console.log('mint', mint.grant?.id, mint.world?.mode);

  try {
    await j('POST', '/internal/grants/mint', {
      feature: 'ocr',
      holder: 'smoke-deny',
      remaining: '1',
      ttl_seconds: 60,
      world_proof_id: 'world:cancel:smoke',
    });
    throw new Error('deny path should have failed');
  } catch (e) {
    if (String(e.message).includes('should have failed')) throw e;
    console.log('deny ok');
  }

  const buy = await j('POST', '/internal/grants/buy-credits', {
    feature: 'ocr',
    holder: 'smoke-buyer',
    amount: '1.00',
    remaining: '5',
    ttl_seconds: 90,
    world_proof_id: 'world:ok:smoke-buyer',
  });
  console.log('buy', buy.settlement?.mode, buy.settlement?.payment_tx);

  const live = await j('GET', '/internal/grants/live?feature=ocr');
  console.log('live grants', (live.grants ?? []).length);

  const run = await j('POST', '/internal/grants/paid-run', {
    grant_id: mint.grant.id,
    amount: '1',
    work: 'smoke',
    skip_mandate_gate: true,
  });
  console.log('paid_run remaining', run.grant?.remaining);

  console.log('SMOKE_OK');
}

main().catch((err) => {
  console.error('SMOKE_FAIL', err.message || err);
  process.exit(1);
});
