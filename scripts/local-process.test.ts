import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ensurePortsAvailable, portAvailable, stopProcessTree } from './local-process.mjs';

const processes: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of processes.splice(0)) if (child.pid) await stopProcessTree(child.pid, 1000);
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bagseven-process-'));
  directories.push(root);
  writeFileSync(join(root, 'listener.mjs'), `import {createServer} from 'node:net';
const server=createServer();server.listen(0,'::',()=>process.send({port:server.address().port}));
process.on('SIGTERM',()=>setTimeout(()=>server.close(()=>process.exit(0)),750));`);
  return root;
}
async function launch(file: string, cwd: string): Promise<number> {
  const child = fork(file, { cwd, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  processes.push(child);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture did not start')), 5000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('message', (message: { port: number }) => { clearTimeout(timeout); resolve(message.port); });
  });
}

describe('local service process lifecycle', () => {
  it('detects a receipt server bound only to the IPv4 loopback address', async () => {
    const root = fixture();
    writeFileSync(join(root, 'ipv4.mjs'), `import {createServer} from 'node:net';
const server=createServer();server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));`);
    const port = await launch(join(root, 'ipv4.mjs'), root);
    expect(await portAvailable(port)).toBe(false);
  });
  it('stops the owning supervisor and waits for slow socket release without respawning', async () => {
    const root = fixture();
    writeFileSync(join(root, 'supervisor.mjs'), `import {fork} from 'node:child_process';
let child,stopping=false;function start(){child=fork('./listener.mjs',{stdio:['ignore','ignore','ignore','ipc']});
child.on('message',message=>process.send(message));child.on('exit',()=>stopping?process.exit(0):start());}
process.on('SIGTERM',()=>{stopping=true;child.kill('SIGTERM');});start();`);
    const port = await launch(join(root, 'supervisor.mjs'), root);
    expect(await portAvailable(port)).toBe(false);
    const started = Date.now();
    await ensurePortsAvailable([port], root, { timeoutMs: 3000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
    expect(await portAvailable(port)).toBe(true);
    await delay(200);
    expect(await portAvailable(port)).toBe(true);
  });
  it('refuses to stop a listener belonging to another checkout', async () => {
    const root = fixture();
    const checkout = join(root, 'another-checkout'); mkdirSync(checkout);
    const port = await launch(join(root, 'listener.mjs'), root);
    await expect(ensurePortsAvailable([port], checkout)).rejects.toThrow('outside this Bagseven checkout');
    expect(await portAvailable(port)).toBe(false);
  });
});
