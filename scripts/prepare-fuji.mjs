#!/usr/bin/env node
import console from 'node:console';
import process from 'node:process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { FUJI_DEPLOYMENT, assertPublicFuji, verifyFujiRegistry } from '@bagseven/onchain';
import { fujiProductionValues } from './fuji-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '.env.prod');
const load = path => existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
try {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_DEPLOYMENT.rpcUrl) });
  await assertPublicFuji(client);
  const current = load(source);
  let registry;
  const manifest = resolve(root, '.data/fuji/registry.json');
  if (existsSync(manifest)) {
    const saved = JSON.parse(readFileSync(manifest, 'utf8'));
    registry = (await verifyFujiRegistry(client, saved.transaction, saved.owner)).address;
  } else if (current.AVALANCHE_ENTITLEMENT_REGISTRY?.trim()) {
    throw Error('Existing registry has no verified public deployment manifest. Run pnpm fuji:registry status after deployment before preparing live configuration.');
  }
  const templates = {};
  for (const path of ['railway/daemon', 'railway/policy', 'railway/gateway', 'railway/mcp', 'vercel/console', 'vercel/landing']) {
    for (const [key, value] of Object.entries(load(resolve(root, `deploy/${path}.env.example`)))) if (!(key in templates)) templates[key] = value;
  }
  const values = fujiProductionValues(current, load(resolve(root, '.env')), templates, FUJI_DEPLOYMENT, registry);
  if (existsSync(source)) {
    const backup = resolve(root, `.data/hosting-backups/${Date.now()}`);
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    copyFileSync(source, resolve(backup, '.env.prod')); chmodSync(resolve(backup, '.env.prod'), 0o600);
  }
  writeFileSync(source, '# Private public-Fuji production source. No owner private key belongs here.\n' +
    Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(source, 0o600);
  execFileSync(process.execPath, [resolve(root, 'scripts/setup-prod.mjs')], { cwd: root, stdio: 'inherit' });
  console.log(`Public Fuji configuration prepared. Registry: ${registry ?? 'PENDING WALLET-APPROVED DEPLOYMENT'}.`);
  console.log('No contracts, tokens or hosted services were deployed by this command. Local Anvil configuration was preserved.');
  console.log('Run pnpm check:prod to see remaining hosting inputs. Do not launch while any check needs setup.');
} catch (error) { console.error(`Fuji preparation failed: ${error.message}`); process.exitCode = 1; }
