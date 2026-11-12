#!/usr/bin/env node
/** Start/stop this checkout's existing product services, with one managed owner. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { ensurePortsAvailable, ownedRuntime, portAvailable, processTable, stopProcessTree } from './local-process.mjs';
import { assertLocalConfiguration } from './local-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const lock = resolve(root, '.data/local-stack.lock');
const ownerFile = resolve(lock, 'owner.json');
const turbo = resolve(root, 'node_modules/turbo/bin/turbo');
let child;
let stopping = false;
let ownsLock = false;
let managedPorts = [];
let shutdown;

function run(args) {
  return new Promise((resolveRun, reject) => {
    child = spawn(process.execPath, [turbo, ...args], { cwd: root, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code, signal) => { child = undefined; stopping || code === 0 ? resolveRun() : reject(new Error(`Workspace command exited ${code ?? signal}`)); });
  });
}

function stopChild() {
  stopping = true;
  shutdown ??= child?.pid ? stopProcessTree(child.pid) : Promise.resolve();
  return shutdown;
}

async function stopOwner() {
  if (!existsSync(lock)) return;
  if (!existsSync(ownerFile)) throw new Error('Another startup is acquiring its lock. Retry after it finishes.');
  const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
  const row = processTable().find(row => row.pid === owner.pid);
  if (row) {
    if (!ownedRuntime(row, root) || !row.command.includes('start-local.mjs')) throw new Error('The local stack lock belongs to an unrecognized live process; it was left running.');
    console.log(`Stopping previous local launcher (PID ${owner.pid})`);
    await stopProcessTree(owner.pid);
  }
  if (existsSync(lock)) {
    if (!existsSync(ownerFile) || JSON.parse(readFileSync(ownerFile, 'utf8')).pid !== owner.pid) {
      throw new Error('Another Bagseven startup acquired the lock. Its services were left running.');
    }
    rmSync(lock, { recursive: true, force: true });
  }
}

async function main() {
  if (existsSync(envPath)) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) process.env[key] ??= value;
  }
  const ports = [3000, 3001, Number(process.env.GATEWAY_PORT || 4000), Number(process.env.DAEMON_PORT || 4001), Number(process.env.POLICY_PORT || 4003)];
  if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(ports).size !== ports.length) throw new Error('Service ports must be distinct integers between 1 and 65535.');
  if (process.argv.includes('--status')) {
    for (const port of ports) console.log(`:${port} ${await portAvailable(port) ? 'stopped' : 'listening'}`);
    return;
  }
  // Validate before stopping a healthy stack or launching a mixture of services.
  if (!process.argv.includes('--stop')) assertLocalConfiguration(process.env);
  await stopOwner();
  await ensurePortsAvailable(ports, root, { log: console.log });
  if (process.argv.includes('--stop')) { console.log('Bagseven local services stopped. Data containers were left running.'); return; }
  if (!existsSync(envPath)) throw new Error('Missing .env — run pnpm run setup first.');
  if (!existsSync(turbo)) throw new Error('Dependencies missing — run pnpm install --frozen-lockfile.');
  mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); } catch { throw new Error('Another Bagseven startup is already in progress.'); }
  ownsLock = true;
  managedPorts = ports;
  writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, root }), { mode: 0o600 });
  for (const [key, bytes] of [['AUTH_SECRET', 32], ['DAEMON_AUTH_TOKEN', 24], ['PROVIDER_GAS_ENCRYPTION_KEY', 32], ['PROVIDER_SCOPE_SIGNING_KEY', 32], ['X402_PAYMENT_ENCRYPTION_KEY', 32]]) {
    if (process.env[key]?.trim()) continue;
    const value = randomBytes(bytes).toString('hex');
    let raw = readFileSync(envPath, 'utf8');
    const re = new RegExp(`^${key}=.*$`, 'm');
    raw = re.test(raw) ? raw.replace(re, () => `${key}=${value}`) : `${raw.trimEnd()}\n${key}=${value}\n`;
    writeFileSync(envPath, raw, { mode: 0o600 });
    process.env[key] = value;
    console.log(`Created missing ${key} locally (value hidden)`);
  }
  writeFileSync(resolve(root, 'apps/console/.env.local'), readFileSync(envPath), { mode: 0o600 });
  process.env.NODE_ENV = 'development';
  // One local process per service: a host-wide PORT would bind all backends
  // to the same socket. Deployments still use PORT in their service entrypoints.
  delete process.env.PORT;
  console.log('Building workspace libraries before starting services…');
  await run(['run', 'build', '--filter=./packages/*', '--env-mode=loose']);
  if (stopping) return;
  await ensurePortsAvailable(ports, root, { log: console.log });
  console.log(`Starting Bagseven: console :3000, landing :3001, gateway :${ports[2]}, daemon :${ports[3]}, policy :${ports[4]}. Stop with Ctrl+C or pnpm stop:local.`);
  await run(['run', 'dev', '--env-mode=loose', '--filter=@bagseven/gateway', '--filter=@bagseven/policy', '--filter=@bagseven/daemon', '--filter=@bagseven/console', '--filter=@bagseven/landing', '--concurrency=12']);
}

process.on('SIGINT', () => { void stopChild(); });
process.on('SIGTERM', () => { void stopChild(); });
main().catch(error => { console.error(`[bagseven] ${error.message}`); process.exitCode = 1; }).finally(async () => {
  await stopChild();
  if (ownsLock) {
    try { await ensurePortsAvailable(managedPorts, root); }
    catch (error) { console.error(`[bagseven] Shutdown: ${error.message}`); process.exitCode = 1; }
    if (existsSync(ownerFile) && JSON.parse(readFileSync(ownerFile, 'utf8')).pid === process.pid) rmSync(lock, { recursive: true, force: true });
  }
});
