/** Process ownership and port lifecycle for this checkout's local services. */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function processTable() {
  if (process.platform === 'linux') {
    const rows = [];
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        rows.push({ pid: Number(entry), ppid: Number(fields[1]), command: readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() });
      } catch { /* Process exited or belongs to another user. */ }
    }
    return rows;
  }
  return execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
  });
}

export function processDirectory(pid) {
  try {
    if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/cwd`);
    const lines = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return lines.split('\n').find(line => line.startsWith('n'))?.slice(1);
  } catch { return undefined; }
}

export function ownedRuntime(row, root) {
  if (!row || row.pid === process.pid) return false;
  const executable = basename(row.command.split(/\s+/)[0]);
  if (!/^(node|nodejs|pnpm|turbo|tsx|next-server)(?:$|[-.])/.test(executable)) return false;
  const cwd = processDirectory(row.pid);
  const checkout = realpathSync(root);
  return Boolean(cwd && (cwd === checkout || cwd.startsWith(checkout + sep)));
}

export function listeningPids(port, rows = processTable()) {
  if (process.platform !== 'linux') {
    try {
      return [...new Set(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/).filter(Boolean).map(Number))];
    } catch (error) {
      if (error.status === 1) return [];
      throw new Error(`Cannot inspect port ${port}; install lsof or stop its listener manually.`);
    }
  }
  const sockets = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of content.trim().split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] === '0A' && parseInt(fields[1].split(':').at(-1), 16) === port) sockets.add(`socket:[${fields[9]}]`);
    }
  }
  if (!sockets.size) return [];
  return rows.filter(row => {
    try { return readdirSync(`/proc/${row.pid}/fd`).some(fd => { try { return sockets.has(readlinkSync(`/proc/${row.pid}/fd/${fd}`)); } catch { return false; } }); }
    catch { return false; }
  }).map(row => row.pid);
}

export function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    server.listen({ port, host: '::' }, () => server.close(() => resolve(true)));
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function stopProcessTree(pid, timeoutMs = 5000) {
  if (pid === process.pid) throw new Error('Refusing to stop the current launcher');
  const rows = processTable();
  const descendants = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; }
  }
  // Stop the supervisor before its children so it cannot replace a listener.
  for (const target of descendants) { try { process.kill(target, 'SIGTERM'); } catch { /* Already stopped. */ } }
  const deadline = Date.now() + timeoutMs;
  while ([...descendants].some(alive) && Date.now() < deadline) await delay(50);
  for (const target of descendants) if (alive(target)) { try { process.kill(target, 'SIGKILL'); } catch { /* Already stopped. */ } }
}

export async function ensurePortsAvailable(ports, root, { timeoutMs = 5000, log = () => {} } = {}) {
  const rows = processTable();
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const targets = new Set();
  for (const port of ports) {
    if (await portAvailable(port)) continue;
    const listeners = listeningPids(port, rows);
    if (!listeners.length || listeners.some(pid => !ownedRuntime(byPid.get(pid), root))) {
      throw new Error(`Port ${port} is occupied by a process outside this Bagseven checkout. Stop it or change the service port; it was left running.`);
    }
    for (const pid of listeners) {
      let row = byPid.get(pid);
      while (ownedRuntime(byPid.get(row.ppid), root)) row = byPid.get(row.ppid);
      targets.add(row.pid);
    }
  }
  await Promise.all([...targets].map(async pid => { log(`Stopping previous Bagseven process tree (PID ${pid})`); await stopProcessTree(pid, timeoutMs); }));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const occupied = [];
    for (const port of ports) if (!await portAvailable(port)) occupied.push(port);
    if (!occupied.length) return;
    if (Date.now() >= deadline) throw new Error(`Ports still occupied after shutdown: ${occupied.join(', ')}. No second stack was started.`);
    await delay(50);
  }
}
