/**
 * pm2 process manager — production-ish single-host layout.
 *
 *   pnpm pm2:start | stop | status | logs
 *
 * Loads repo-root `.env` for every process (Next included).
 */
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

function loadEnvFile() {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    let val = line.slice(i + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, i)] = val;
  }
  return out;
}

const fileEnv = loadEnvFile();

module.exports = {
  apps: [
    {
      name: 'gateway',
      cwd: './services/gateway',
      script: 'node',
      args: 'dist/index.js',
      env: fileEnv,
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'bagseven-daemon',
      cwd: './services/daemon',
      script: 'node',
      args: 'dist/index.js',
      env: fileEnv,
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'policy',
      cwd: './services/policy',
      script: 'node',
      args: 'dist/index.js',
      env: fileEnv,
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'console',
      cwd: './apps/console',
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -p 3000',
      env: { ...fileEnv, NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
    {
      name: 'landing',
      cwd: './apps/landing',
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -p 3001',
      env: { ...fileEnv, NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      time: true,
    },
  ],
};
