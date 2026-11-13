#!/usr/bin/env node
/** Switch local product surfaces to the verified PUBLIC chain. Never signs transactions. */
import process from 'node:process';
import console from 'node:console';
import { createRequire } from 'node:module';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  renameSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, parseAbi } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { FUJI_DEPLOYMENT, verifyFujiRegistry } from '@bagseven/onchain';
import { createDb } from '@bagseven/db';
import { publicFujiRuntime } from './fuji-runtime-config.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Pool } = require('pg');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const read = (file) => (existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {});
const privateSave = (file, text) => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, file);
  chmodSync(file, 0o600);
};
try {
  const manifestFile = resolve(root, '.data/fuji/registry.json');
  if (!existsSync(manifestFile))
    throw Error('Deploy and verify the public Fuji registry first. No active configuration changed.');
  const saved = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const client = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_DEPLOYMENT.rpcUrl) });
  const registry = await verifyFujiRegistry(client, saved.transaction, saved.owner);
  const abi = parseAbi(['function decimals() view returns(uint8)', 'function symbol() view returns(string)']);
  if (
    (await client.readContract({ address: FUJI_DEPLOYMENT.token, abi, functionName: 'decimals' })) !== 6 ||
    (await client.readContract({ address: FUJI_DEPLOYMENT.token, abi, functionName: 'symbol' })) !== 'USDC'
  )
    throw Error('Configured public token failed validation');
  const current = read(resolve(root, '.env')),
    live = read(resolve(root, '.env.prod'));
  const priorFile = resolve(root, '.data/fuji/runtime.json');
  const prior = existsSync(priorFile) ? JSON.parse(readFileSync(priorFile, 'utf8')) : null;
  const sourceUrl = new URL(current.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(sourceUrl.hostname))
    throw Error('This switch is for locally served product ports only; configure hosting separately');
  const target = new URL(sourceUrl);
  target.pathname = '/bagseven_fuji';
  const cache = new URL(current.REDIS_URL);
  cache.pathname = '/1';
  const values = publicFujiRuntime(
    current,
    live,
    FUJI_DEPLOYMENT,
    registry.address,
    target.toString(),
    cache.toString(),
    resolve(root, '.data/fuji/runtime'),
  );
  console.log(
    `Public Fuji (43113)\nRegistry: ${registry.address}\nUSDC: ${FUJI_DEPLOYMENT.token}\nRPC: ${FUJI_DEPLOYMENT.rpcUrl}\nDatabase: bagseven_fuji (separate from Anvil)\nProduct: console :3000, landing :3001; gateway :4000, daemon :4001, policy :4003, MCP :4009\nDevelopment seed authority and payment mocks: removed\nNo old credits, contracts, permissions or billing plans will be imported.`,
  );
  if (!process.argv.includes('--apply')) {
    console.log('Read-only preflight passed. Run pnpm fuji:activate --apply to switch.');
    process.exit(0);
  }
  const admin = new Pool({ connectionString: sourceUrl.toString() });
  try {
    const found = await admin.query('select 1 from pg_database where datname=$1', ['bagseven_fuji']);
    if (found.rowCount && (!prior || prior.registry.toLowerCase() !== registry.address.toLowerCase()))
      throw Error(
        'An existing Fuji database is not bound to this verified manifest; refusing to overwrite or import it',
      );
    if (!found.rowCount) {
      await admin.query('CREATE DATABASE bagseven_fuji');
      privateSave(
        priorFile,
        JSON.stringify({
          registry: registry.address,
          transaction: registry.transaction,
          phase: 'database-created',
        }) + '\n',
      );
    }
  } finally {
    await admin.end();
  }
  const db = createDb({ connectionString: target.toString() });
  try {
    await migrate(db, { migrationsFolder: resolve(root, 'packages/db/drizzle') });
  } finally {
    await db.$client.end();
  }
  const backup = resolve(root, `.data/fuji/backups/${Date.now()}`);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const file of ['.env', 'apps/console/.env.local'])
    if (existsSync(resolve(root, file))) {
      const out = resolve(backup, file);
      mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
      copyFileSync(resolve(root, file), out);
      chmodSync(out, 0o600);
    }
  execFileSync(process.execPath, [resolve(root, 'scripts/start-local.mjs'), '--stop'], {
    cwd: root,
    stdio: 'inherit',
  });
  // Stop only the old MCP owner; starting it again reads the fresh public-chain credentials.
  const { ensurePortsAvailable } = await import('./local-process.mjs');
  await ensurePortsAvailable([4009], root, { log: console.log });
  const contents =
    '# Active public Avalanche Fuji runtime. Wallet deployment keys stay in the encrypted keystore.\n' +
    Object.entries(values)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') +
    '\n';
  privateSave(resolve(root, '.env'), contents);
  privateSave(resolve(root, 'apps/console/.env.local'), contents);
  privateSave(
    priorFile,
    JSON.stringify({
      registry: registry.address,
      transaction: registry.transaction,
      phase: 'active',
      backup,
      activatedAt: new Date().toISOString(),
    }) + '\n',
  );
  console.log(
    'Public Fuji runtime selected. Start with pnpm start:local and pnpm mcp:local. Sign in again and approve/fund provider gas before creating live plans. No financial approval or balance was copied from Anvil.',
  );
} catch (error) {
  console.error(`Fuji activation: ${error.message}`);
  process.exitCode = 1;
}
