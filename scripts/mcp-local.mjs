#!/usr/bin/env node
/**
 * Start worker-bound MCP from .env
 *   pnpm mcp:local
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePortsAvailable } from './local-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

if (!existsSync(envPath)) {
  console.error('Missing .env — run: pnpm run setup');
  process.exit(1);
}

for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) process.env[key] ??= value;

if (!process.env.BAGSEVEN_MCP_WORKER?.trim()) {
  console.error(`
BAGSEVEN_MCP_WORKER is empty in .env.

1. Start the stack:  pnpm start:local
2. Open Console:     http://localhost:3000/app/mcp
3. Create an agent slot (the local console saves its binding)
4. Re-run:           pnpm mcp:local
`);
  process.exit(1);
}

process.env.BAGSEVEN_MCP_PORT ||= '4009';
process.env.DAEMON_URL ??= 'http://127.0.0.1:4001';
delete process.env.PORT;
const port = Number(process.env.BAGSEVEN_MCP_PORT);
const otherPorts = [3000, 3001, Number(process.env.GATEWAY_PORT || 4000), Number(process.env.DAEMON_PORT || 4001), Number(process.env.POLICY_PORT || 4003)];
if (!Number.isInteger(port) || port < 1 || port > 65535 || otherPorts.includes(port)) {
  console.error('[mcp] BAGSEVEN_MCP_PORT must be a valid port separate from the frontend/backend ports.');
  process.exit(1);
}
try { await ensurePortsAvailable([port], root, { log: console.log }); }
catch (error) { console.error(`[mcp] ${error.message}`); process.exit(1); }

console.log(`[mcp] worker=${process.env.BAGSEVEN_MCP_WORKER} port=${process.env.BAGSEVEN_MCP_PORT}`);

const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/bagseven-mcp.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child.kill(signal); });
child.on('error', () => { console.error('[mcp] Could not start the MCP process'); process.exitCode = 1; });
child.on('exit', (code) => process.exit(stopping ? 0 : code ?? 1));
