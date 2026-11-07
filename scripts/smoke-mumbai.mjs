#!/usr/bin/env node
/** Read-only checks for a running stack. Use smoke:e2e for the isolated write flow. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const daemon = (process.env.DAEMON_URL || 'http://localhost:4001').replace(/\/$/, '');
const targets = [
  ['gateway', process.env.GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000'],
  ['policy', process.env.POLICY_URL || 'http://localhost:4003'],
  ['daemon', daemon],
];
async function get(base, path, headers = {}) {
  let response;
  try { response = await fetch(`${base.replace(/\/$/, '')}${path}`, { headers, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error('Service unreachable. Start the platform with pnpm start:local and check its logs.'); }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}; verify the service configuration and credentials.`);
  return response.json();
}
try {
  for (const [name, base] of targets) {
    if (!(await get(base, '/healthz')).ok) throw new Error(`${name} health check failed`);
    console.log(`PASS ${name} health`);
  }
  const auth = process.env.DAEMON_AUTH_TOKEN ? { authorization: `Bearer ${process.env.DAEMON_AUTH_TOKEN}` } : {};
  const status = await get(daemon, '/internal/mumbai/status', auth);
  if (!status.tracks) throw new Error('Daemon track status was missing');
  console.log('PASS authenticated daemon track status');
  console.log('SMOKE_OK (read-only; no grants, emails or payments created)');
} catch (error) { console.error(`SMOKE_FAIL ${error.message}`); process.exitCode = 1; }
