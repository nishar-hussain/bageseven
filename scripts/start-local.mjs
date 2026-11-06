#!/usr/bin/env node
/**
 * Start Bagseven local stack.
 *   pnpm start:local
 *
 * Landing :3001 + Dashboard :3000 + gateway/policy/daemon.
 * Frees stale listeners on those ports before boot (avoids EADDRINUSE).
 */
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

function ensurePnpmShim() {
  const bin = resolve(root, '.bagseven-bin');
  mkdirSync(bin, { recursive: true });
  const shim = resolve(bin, 'pnpm');
  writeFileSync(shim, '#!/bin/sh\nexec corepack pnpm "$@"\n');
  chmodSync(shim, 0o755);
  return bin;
}

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error('Missing .env — run: pnpm setup');
    process.exit(1);
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i);
    let val = line.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function upsertEnvFile(key, value) {
  let raw = readFileSync(envPath, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(raw)) raw = raw.replace(re, `${key}=${value}`);
  else raw = `${raw.trimEnd()}\n${key}=${value}\n`;
  writeFileSync(envPath, raw);
  process.env[key] = value;
}

function ensureSecrets() {
  if (!process.env.AUTH_SECRET?.trim()) {
    upsertEnvFile('AUTH_SECRET', randomBytes(32).toString('hex'));
    console.log('  wrote AUTH_SECRET to .env');
  }
  if (!process.env.DAEMON_AUTH_TOKEN?.trim()) {
    upsertEnvFile('DAEMON_AUTH_TOKEN', randomBytes(24).toString('hex'));
    console.log('  wrote DAEMON_AUTH_TOKEN to .env');
  }
}

/** Next only auto-loads env files inside apps/console — copy root .env there. */
function syncConsoleEnv() {
  const dest = resolve(root, 'apps/console/.env.local');
  writeFileSync(dest, readFileSync(envPath));
}

function freePorts(ports) {
  for (const port of ports) {
    try {
      const out = execSync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) continue;
      for (const pid of out.split(/\s+/)) {
        try {
          process.kill(Number(pid), 'SIGTERM');
          console.log(`  freed :${port} (pid ${pid})`);
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* nothing listening */
    }
  }
  // brief settle so sockets release
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
}

loadEnv();
ensureSecrets();
syncConsoleEnv();

if (!existsSync(resolve(root, 'services/daemon/dist/index.js'))) {
  console.error('Build missing — run: pnpm setup   (or pnpm build)');
  process.exit(1);
}

const gateway = Number(process.env.GATEWAY_PORT ?? 4000);
const daemon = Number(process.env.DAEMON_PORT ?? 4001);
const policy = Number(process.env.POLICY_PORT ?? 4003);

console.log(`
Starting Bagseven…
  Landing    :3001  →  Fianto marketing
  Dashboard  :3000  →  Fianto-style app (/app)
  Gateway    :${gateway}
  Daemon     :${daemon}
  Policy     :${policy}
`);

console.log('Checking ports…');
freePorts([3000, 3001, gateway, daemon, policy]);

const shimBin = ensurePnpmShim();
const turboBin = resolve(root, 'node_modules/turbo/bin/turbo');
const child = spawn(
  process.execPath,
  [
    turboBin,
    'run',
    'dev',
    '--env-mode=loose',
    '--filter=@bagseven/gateway',
    '--filter=@bagseven/policy',
    '--filter=@bagseven/daemon',
    '--filter=@bagseven/console',
    '--filter=@bagseven/landing',
    '--concurrency=12',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${shimBin}:${process.env.PATH ?? ''}`,
    },
  },
);

function shutdown() {
  child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

child.on('exit', (code) => process.exit(code ?? 0));
