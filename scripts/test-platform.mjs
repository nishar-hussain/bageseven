#!/usr/bin/env node
/** Unit tests need built workspace libraries, not production Next.js builds. */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let child;
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; child?.kill(signal); });
async function run(file, args) {
  return new Promise((done, reject) => {
    child = spawn(process.execPath, [resolve(root, file), ...args], { cwd: root, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`Test command exited ${code ?? signal}`)));
  });
}
try {
  await run('node_modules/turbo/bin/turbo', ['run', 'build', '--filter=./packages/*']);
  if (!stopped) await run('node_modules/vitest/vitest.mjs', ['run', ...process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'))]);
} catch (error) { console.error(`[bagseven:test] ${error.message}`); process.exitCode = 1; }
