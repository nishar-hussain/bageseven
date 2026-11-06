import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(name, args, env = {}) {
  const child = spawn(name, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  return child;
}

const api = run('node', ['--env-file-if-exists=../../.env', 'server.mjs']);
const web = run('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5177', '--strictPort']);

function shutdown() {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
