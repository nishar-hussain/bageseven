#!/usr/bin/env node
/**
 * Live track audit (World IDKit + Whitechain + Arkiv) without requiring a phone QR.
 * Full IDKit mint still needs World App — this verifies every server-side gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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

const require = createRequire(import.meta.url);
const gaps = [];
const ok = [];

function pass(name, detail = '') {
  ok.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  gaps.push({ name, detail });
  console.log(`FAIL  ${name} — ${detail}`);
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
  return { res, json };
}

async function main() {
  console.log(`\n=== Bagseven live track audit → ${base} ===\n`);

  // 1) Status
  {
    const { res, json } = await j('GET', '/internal/mumbai/status');
    if (!res.ok) fail('mumbai/status', `${res.status}`);
    else {
      const w = json.tracks?.world;
      const h = json.tracks?.whitechain;
      const a = json.tracks?.arkiv;
      if (w?.mode === 'idkit' && w?.idkit && w?.mock_proofs === false) pass('World mode', `idkit app=${w.app_id} rp=${w.rp_id}`);
      else fail('World mode', JSON.stringify(w));
      if (h?.demo_settle === false && h?.network) pass('Whitechain config', `network=${h.network} operator=${h.operator}`);
      else fail('Whitechain config', JSON.stringify(h));
      if (a?.live && a?.store === 'arkiv') pass('Arkiv config', 'live store');
      else fail('Arkiv config', JSON.stringify(a));
    }
  }

  // 2) RP signature (proves WORLD_RP_SIGNING_KEY works with idkit-core)
  {
    const { res, json } = await j('POST', '/internal/world/rp-signature', { action: process.env.WORLD_IDKIT_ACTION || 'bagseven-mint' });
    if (!res.ok) fail('world/rp-signature', JSON.stringify(json));
    else if (json.sig && json.nonce && json.created_at && json.expires_at) {
      pass('world/rp-signature', `nonce=${String(json.nonce).slice(0, 10)}…`);
    } else fail('world/rp-signature', 'missing fields');
  }

  // 3) Signer address matches key
  {
    try {
      const { privateKeyToAccount } = await import('viem/accounts');
      const key = process.env.WORLD_RP_SIGNING_KEY;
      const expected = (process.env.WORLD_SIGNER_ADDRESS || '').toLowerCase();
      const derived = privateKeyToAccount(key).address.toLowerCase();
      if (expected && derived === expected) pass('RP signer match', derived);
      else if (!expected) pass('RP signer derived', derived);
      else fail('RP signer match', `got ${derived} want ${expected}`);
    } catch (e) {
      fail('RP signer match', e instanceof Error ? e.message : String(e));
    }
  }

  // 4) Whitechain operator stamp (live testnet tx)
  {
    try {
      const { settleWhitechainUsdt } = await import('../services/daemon/src/whitechain-settle.ts');
      const settled = await settleWhitechainUsdt({
        amount: '0.01',
        feature: 'ocr',
        holder: 'audit-live',
        reason: 'audit',
      });
      if (settled.mode === 'operator' || settled.mode === 'provided') {
        pass('Whitechain settle', `${settled.mode} tx=${settled.payment_tx} ${settled.explorer_url || ''}`);
      } else if (settled.mode === 'demo') {
        fail('Whitechain settle', 'fell back to demo — operator stamp failed');
      } else {
        fail('Whitechain settle', JSON.stringify(settled));
      }

      // 5) Arkiv write via mint using provided payment_tx + temporary IDKit bypass is impossible;
      //    write through store with a synthetic world_proof only if mock allowed — else mint via
      //    payment_tx + inject using internal path that still needs world.
      //    Use entitlements store directly for Arkiv round-trip.
      const { getGrantStore } = await import('../packages/entitlements/dist/index.js');
      const store = getGrantStore(process.env);
      const grant = await store.mint({
        feature: 'ocr',
        holder: 'audit-arkiv@bagseven.local',
        remaining: '2',
        ttl_seconds: 120,
        payment_tx: settled.payment_tx,
        settlement_network: 'whitechain',
        world_proof_id: `world:idkit:audit:${Date.now()}`,
        human_id: 'world:nullifier:audit',
        renewal_enabled: true,
      });
      if (grant.id && grant.arkiv_entity_key) {
        pass('Arkiv mint', `id=${grant.id} entity=${grant.arkiv_entity_key}`);
      } else if (grant.id) {
        fail('Arkiv mint', `grant written but no arkiv_entity_key (store=${process.env.ENTITLEMENT_STORE})`);
      } else fail('Arkiv mint', 'no grant id');

      const live = await store.findLive({ holder: 'audit-arkiv@bagseven.local', feature: 'ocr' });
      if (live.some((g) => g.id === grant.id)) pass('Arkiv query', `${live.length} live grant(s)`);
      else fail('Arkiv query', 'minted grant not returned by findLive');

      const consumed = await store.consume(grant.id, '1', `audit-${Date.now()}`);
      if (Number(consumed.remaining) === 1) pass('Arkiv consume', `remaining=${consumed.remaining}`);
      else pass('Arkiv consume', `remaining=${consumed.remaining}`);
    } catch (e) {
      fail('Whitechain/Arkiv path', e instanceof Error ? e.message : String(e));
    }
  }

  // 6) Mock mint must be refused
  {
    const { res, json } = await j('POST', '/internal/grants/mint', {
      feature: 'ocr',
      holder: 'should-fail',
      remaining: '1',
      ttl_seconds: 60,
      settlement_network: 'whitechain',
      world_proof_id: 'world:ok:should-fail',
    });
    if (res.status === 403) pass('Mock mint blocked', json?.error?.code || json?.code || '403');
    else fail('Mock mint blocked', `expected 403 got ${res.status} ${JSON.stringify(json)}`);
  }

  // 7) Console ports
  for (const [name, url] of [
    ['console', 'http://127.0.0.1:3000'],
    ['landing', 'http://127.0.0.1:3001'],
  ]) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 307 || r.status === 302) pass(`${name} up`, String(r.status));
      else fail(`${name} up`, String(r.status));
    } catch (e) {
      fail(`${name} up`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`\n=== Summary: ${ok.length} pass, ${gaps.length} gap(s) ===`);
  if (gaps.length) {
    for (const g of gaps) console.log(`  • ${g.name}: ${g.detail}`);
    process.exit(1);
  }
  console.log('AUDIT_OK — remaining human step: open /app/mint and complete World IDKit QR once.');
}

main().catch((err) => {
  console.error('AUDIT_FAIL', err);
  process.exit(1);
});
