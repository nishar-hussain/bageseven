#!/usr/bin/env node
/** One local command keeps the ngrok origin, OAuth issuer and MCP process aligned. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), envPath = resolve(root, '.env');
const env = { ...process.env, ...parseEnv(readFileSync(envPath, 'utf8')) };
if (env.NODE_ENV === 'production') throw Error('Use managed HTTPS hosting in production; this launcher is for a local workstation');
if (env.MCP_OAUTH_REQUIRED !== 'true') throw Error('HTTPS MCP requires OAuth. Set MCP_OAUTH_REQUIRED=true; development auth bypass is not allowed.');
const port = Number(env.BAGSEVEN_MCP_PORT || 4009);
if (port !== 4009) throw Error('Use the existing product MCP port 4009');
let tunnel, mcp, stopped = false, diagnostic = '';
function stop(signal = 'SIGTERM') { if (stopped) return; stopped = true; mcp?.kill(signal); tunnel?.kill(signal); }
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => stop(signal));
async function origin() {
  try {
    const data = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1000) }).then(r => r.json());
    const found = data.tunnels?.find(t => t.public_url?.startsWith('https:') && ['http://localhost:4009','http://127.0.0.1:4009','localhost:4009'].includes(t.config?.addr));
    return found?.public_url;
  } catch { return undefined; }
}
try {
  let url = await origin();
  if (!url) {
    const binary = existsSync(resolve(root, '.data/bin/ngrok')) ? resolve(root, '.data/bin/ngrok') : 'ngrok';
    tunnel = spawn(binary, ['http', String(port), '--log=stdout', '--log-format=json'], { cwd: root, env, stdio: ['ignore','pipe','pipe'] });
    tunnel.on('error', error => { diagnostic = error.message; });
    for (const stream of [tunnel.stdout,tunnel.stderr]) stream.on('data', b => { diagnostic = (diagnostic + b.toString()).slice(-4000); });
    for (let i = 0; i < 80 && !stopped; i++) {
      url = await origin(); if (url) break;
      if (tunnel.exitCode !== null) throw Error(`ngrok failed to start: ${diagnostic}`);
      await new Promise(r => setTimeout(r, 250));
    }
  }
  if (!url || stopped) throw Error('No HTTPS tunnel became available');
  let raw = readFileSync(envPath, 'utf8');
  const line = `BAGSEVEN_MCP_PUBLIC_URL=${url}`;
  raw = /^BAGSEVEN_MCP_PUBLIC_URL=.*$/m.test(raw) ? raw.replace(/^BAGSEVEN_MCP_PUBLIC_URL=.*$/m, line) : `${raw.trimEnd()}\n${line}\n`;
  writeFileSync(envPath, raw, { mode: 0o600 });
  console.log(`Bagseven HTTPS MCP: ${url}/mcp`);
  console.log('OAuth remains required. If this URL changes, update the existing Avalanche plugin connection package.');
  mcp = spawn(process.execPath, ['scripts/mcp-local.mjs'], { cwd: root, env: { ...env, BAGSEVEN_MCP_PUBLIC_URL: url }, stdio: 'inherit' });
  mcp.on('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
  mcp.on('exit', code => { stop(); process.exitCode = code || 0; });
  tunnel?.on('exit', code => { if (!stopped) { console.error('The MCP HTTPS tunnel stopped. Restart pnpm mcp:tunnel.'); stop(); process.exitCode = code || 1; } });
} catch (error) { stop(); console.error(error.message); process.exitCode = 1; }
