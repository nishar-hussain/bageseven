import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout } from 'node:timers';

// Optional shared container for Railway projects with a five-service limit.
// MCP owns the public port and proxies authenticated daemon API routes locally.
const embedded = process.env.BAGSEVEN_MCP_EMBEDDED === 'true';
const publicPort = process.env.PORT || '4001';
const daemonPort = embedded ? '4001' : publicPort;
if (embedded && publicPort === daemonPort) {
  throw new Error('Embedded MCP requires PORT=4009; daemon uses internal port 4001');
}
const children = [spawn(process.execPath, ['services/daemon/dist/index.js'], {
  stdio: 'inherit', env: { ...process.env, PORT: daemonPort },
})];
if (embedded) children.push(spawn(process.execPath, ['--import', 'tsx', 'scripts/bagseven-mcp.ts'], {
  stdio: 'inherit', env: { ...process.env, PORT: publicPort, DAEMON_URL: `http://127.0.0.1:${daemonPort}`, BAGSEVEN_DAEMON_PROXY_URL: `http://127.0.0.1:${daemonPort}` },
}));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
