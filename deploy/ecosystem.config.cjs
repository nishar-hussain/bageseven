/**
 * pm2 process manager config — keeps every Bagseven service alive and
 * auto-restarts it on crash, surviving across shell sessions.
 *
 *   pnpm pm2:start    # start all services (persistent)
 *   pnpm pm2:status   # status dashboard
 *   pnpm pm2:logs     # follow all logs
 *   pnpm pm2:stop     # stop everything
 */
module.exports = {
  apps: [
    { name: 'gateway', cwd: './services/gateway', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'bagseven-daemon', cwd: './services/daemon', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'policy', cwd: './services/policy', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'console', cwd: './apps/console', script: 'node', args: 'node_modules/next/dist/bin/next start -p 3000', autorestart: true, max_restarts: 20, time: true },
    { name: 'landing', cwd: './apps/landing', script: 'node', args: 'node_modules/next/dist/bin/next start -p 3001', autorestart: true, max_restarts: 20, time: true },
    { name: 'bagseven-mcp', cwd: '.', script: 'pnpm', args: 'bagseven-mcp', autorestart: true, max_restarts: 20, time: true },
  ],
};
