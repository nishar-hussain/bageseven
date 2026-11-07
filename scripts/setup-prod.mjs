#!/usr/bin/env node
/** Prepare private hosting import files without reading local development keys. */
import { randomBytes, randomUUID } from 'node:crypto';
import console from 'node:console';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const master = resolve(root, '.env.prod');
const targets = [
  ['deploy/railway/daemon.env.example', 'services/daemon/.env.prod'],
  ['deploy/railway/gateway.env.example', 'services/gateway/.env.prod'],
  ['deploy/railway/policy.env.example', 'services/policy/.env.prod'],
  ['deploy/railway/mcp.env.example', 'scripts/.env.prod'],
  ['deploy/vercel/console.env.example', 'apps/console/.env.prod'],
  ['deploy/vercel/landing.env.example', 'apps/landing/.env.prod'],
].map(([source, output]) => ({ source, output, values: parseEnv(readFileSync(resolve(root, source), 'utf8')) }));

const serialize = (values) => Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
function save(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

if (!existsSync(master)) {
  const values = {};
  for (const target of targets) {
    for (const [key, value] of Object.entries(target.values)) {
      // Each Railway service has its own port in its generated import file.
      if (key !== 'PORT' && !(key in values)) values[key] = value;
    }
  }
  values.AUTH_SECRET = randomBytes(32).toString('hex');
  values.DAEMON_AUTH_TOKEN = randomBytes(32).toString('hex');
  values.POLICY_INTERNAL_TOKEN = randomBytes(32).toString('hex');
  values.PROVIDER_ADMIN_TOKEN = randomBytes(32).toString('hex');
  values.BAGSEVEN_MCP_WORKER = randomUUID();
  values.BAGSEVEN_PUBLISHABLE_KEY = `pk_live_${randomBytes(16).toString('hex')}`;
  values.BAGSEVEN_SECRET_KEY = `sk_live_${randomBytes(32).toString('hex')}`;
  // These addresses are reached from Vercel, so they must be public HTTPS URLs.
  values.DAEMON_URL = 'https://REPLACE_DAEMON.up.railway.app';
  values.GATEWAY_URL = 'https://REPLACE_GATEWAY.up.railway.app';
  values.BAGSEVEN_MCP_PUBLIC_URL = 'https://REPLACE_MCP.up.railway.app';
  // Derived values below are refreshed from their canonical source on every run.
  delete values.GATEWAY_AUTH_TOKEN;
  delete values.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY;
  delete values.NEXT_PUBLIC_WORLD_APP_ID;
  delete values.NEXT_PUBLIC_WORLD_RP_ID;
  delete values.NEXT_PUBLIC_WORLD_IDKIT_ACTION;
  delete values.NEXT_PUBLIC_WORLD_IDKIT_ENVIRONMENT;
  delete values.NEXT_PUBLIC_WHITECHAIN_CHAIN_ID;
  delete values.NEXT_PUBLIC_WHITECHAIN_USDT;
  delete values.NEXT_PUBLIC_WHITECHAIN_RPC_URL;
  delete values.NEXT_PUBLIC_WHITECHAIN_EXPLORER;
  delete values.NEXT_PUBLIC_BAGSEVEN_API_URL;
  delete values.WORLD_REDIRECT_URI;
  const header = '# Private production source. Edit here, then run pnpm setup:prod again.\n' +
    '# Generated import files are overwritten; this source and its secrets are preserved.\n' +
    '# Replace every REPLACE_* value. Railway references are expanded by Railway only.\n' +
    '# Defaults: live World + Arkiv, live Whitechain testnet (1874), dual-gate required.\n';
  save(master, header + serialize(values));
}

const values = parseEnv(readFileSync(master, 'utf8'));
// Upgrade existing deployment sources without rotating deposited-account keys.
if (!values.PROVIDER_GAS_ENCRYPTION_KEY || values.PROVIDER_GAS_ENCRYPTION_KEY.startsWith('REPLACE_')) {
  values.PROVIDER_GAS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  save(master, readFileSync(master, 'utf8').replace(/^PROVIDER_GAS_ENCRYPTION_KEY=.*\n?/m, '') +
    `\nPROVIDER_GAS_ENCRYPTION_KEY=${JSON.stringify(values.PROVIDER_GAS_ENCRYPTION_KEY)}\n`);
}
if (!/^[a-f0-9]{64}$/i.test(values.PROVIDER_GAS_ENCRYPTION_KEY)) {
  throw new Error('PROVIDER_GAS_ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters; existing value was preserved.');
}
const consoleUrl = values.NEXT_PUBLIC_CONSOLE_URL?.replace(/\/$/, '');
const derived = {
  GATEWAY_AUTH_TOKEN: values.POLICY_INTERNAL_TOKEN,
  NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY: values.BAGSEVEN_PUBLISHABLE_KEY,
  NEXT_PUBLIC_BAGSEVEN_API_URL: `${consoleUrl}/api/public`,
  WORLD_REDIRECT_URI: `${consoleUrl}/app/mint`,
  NEXT_PUBLIC_WHITECHAIN_EXPLORER: values.WHITECHAIN_NETWORK === 'mainnet'
    ? 'https://explorer.whitechain.io' : 'https://explorer.testnet.whitechain.io',
};
for (const [key, source] of Object.entries({
  NEXT_PUBLIC_WORLD_APP_ID: 'WORLD_APP_ID', NEXT_PUBLIC_WORLD_RP_ID: 'WORLD_RP_ID',
  NEXT_PUBLIC_WORLD_IDKIT_ACTION: 'WORLD_IDKIT_ACTION', NEXT_PUBLIC_WORLD_IDKIT_ENVIRONMENT: 'WORLD_IDKIT_ENVIRONMENT',
  NEXT_PUBLIC_WHITECHAIN_CHAIN_ID: 'WHITECHAIN_CHAIN_ID', NEXT_PUBLIC_WHITECHAIN_USDT: 'WHITECHAIN_USDT',
  NEXT_PUBLIC_WHITECHAIN_RPC_URL: 'WHITECHAIN_RPC_URL',
})) derived[key] = values[source];

for (const target of targets) {
  const output = {};
  for (const [key, fallback] of Object.entries(target.values)) {
    output[key] = derived[key] ?? values[key] ?? fallback;
  }
  if (target.output === 'scripts/.env.prod') {
    output.DAEMON_URL = target.values.DAEMON_URL; // MCP uses Railway private networking.
  }
  save(resolve(root, target.output), `# Import into ${target.output.startsWith('apps/') ? 'Vercel Production variables' : 'the matching Railway service variables'}.\n# Generated from root .env.prod by pnpm setup:prod; do not edit this copy.\n` + serialize(output));
  console.log(`Prepared ${target.output}`);
}
// IaC services read only their own subset of these environment-level references.
// Internal URLs, ports and managed database references are supplied by the graph.
const internal = new Set(['PORT', 'HOST', 'DATABASE_URL', 'REDIS_URL', 'POLICY_URL', 'DAEMON_URL', 'BAGSEVEN_DATA_DIR']);
const shared = {};
for (const target of targets.filter(target => !target.output.startsWith('apps/'))) {
  for (const [key, fallback] of Object.entries(target.values)) {
    if (!internal.has(key)) shared[key] = derived[key] ?? values[key] ?? fallback;
  }
}
save(resolve(root, '.railway/.env.prod'), '# Import into Railway environment Shared Variables before config apply.\n' + serialize(shared));
console.log('Prepared .railway/.env.prod (Railway shared variables for project-wide deployment)');
const unresolved = Object.entries(values).filter(([, value]) => value.includes('REPLACE_')).map(([key]) => key);
console.log(`Source: .env.prod (preserved). ${unresolved.length} values still need your hosted URLs or provider credentials.`);
if (unresolved.length) console.log(`Update: ${unresolved.join(', ')}`);
console.log('These files are ignored by Git and Docker. Import them into hosting variables; .env.prod is not auto-loaded by Railway or Next.js.');
