#!/usr/bin/env node
/**
 * Start worker-bound MCP from .env
 *   pnpm mcp:local
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

if (!existsSync(envPath)) {
  console.error('Missing .env — run: pnpm setup');
  process.exit(1);
}

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i <= 0) continue;
  const key = line.slice(0, i);
  const val = line.slice(i + 1);
  if (process.env[key] === undefined) process.env[key] = val;
}

if (!process.env.BAGSEVEN_MCP_WORKER?.trim()) {
  console.error(`
BAGSEVEN_MCP_WORKER is empty in .env.

1. Start the stack:  pnpm start:local
2. Open Console:     http://localhost:3000
3. Create / select a worker
4. Put its UUID in .env as BAGSEVEN_MCP_WORKER=...
5. Re-run:           pnpm mcp:local
`);
  process.exit(1);
}

process.env.BAGSEVEN_MCP_PORT ??= '4009';
process.env.DAEMON_URL ??= 'http://127.0.0.1:4001';

console.log(`[mcp] worker=${process.env.BAGSEVEN_MCP_WORKER} port=${process.env.BAGSEVEN_MCP_PORT}`);

const child = spawn('pnpm', ['bagseven-mcp'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
