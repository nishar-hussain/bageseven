import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const folders: string[] = [];
afterEach(() => { folders.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'bagseven-prod-')); folders.push(root);
  for (const path of ['scripts', 'apps/console', 'apps/landing', 'services/daemon', 'services/policy', 'services/gateway']) mkdirSync(resolve(root, path), { recursive: true });
  cpSync('deploy', resolve(root, 'deploy'), { recursive: true });
  cpSync('scripts/setup-prod.mjs', resolve(root, 'scripts/setup-prod.mjs'));
  return root;
}
const read = (root: string, file: string) => parseEnv(readFileSync(resolve(root, file), 'utf8'));
const run = (root: string) => execFileSync(process.execPath, [resolve(root, 'scripts/setup-prod.mjs')], { encoding: 'utf8' });

describe('production provider gas configuration', () => {
  it('upgrades an existing source once and distributes a stable private key only to signing services', () => {
    const root = fixture();
    writeFileSync(resolve(root, '.env.prod'), 'AUTH_SECRET=existing-auth-secret\n');
    const output = run(root);
    const key = read(root, '.env.prod').PROVIDER_GAS_ENCRYPTION_KEY;
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(output).not.toContain(key);
    for (const file of ['services/daemon/.env.prod', 'services/policy/.env.prod', 'apps/console/.env.prod']) expect(read(root, file).PROVIDER_GAS_ENCRYPTION_KEY).toBe(key);
    for (const file of ['services/gateway/.env.prod', 'scripts/.env.prod', 'apps/landing/.env.prod']) expect(read(root, file).PROVIDER_GAS_ENCRYPTION_KEY).toBeUndefined();
    run(root);
    expect(read(root, '.env.prod').PROVIDER_GAS_ENCRYPTION_KEY).toBe(key);
    expect(read(root, '.env.prod').AUTH_SECRET).toBe('existing-auth-secret');
  });
  it('preserves an existing account encryption key and refuses to replace malformed keys', () => {
    const root = fixture();
    const path = resolve(root, '.env.prod');
    writeFileSync(path, `PROVIDER_GAS_ENCRYPTION_KEY=${'ab'.repeat(32)}\n`);
    run(root);
    expect(read(root, '.env.prod').PROVIDER_GAS_ENCRYPTION_KEY).toBe('ab'.repeat(32));
    writeFileSync(path, 'PROVIDER_GAS_ENCRYPTION_KEY=invalid-existing-key\n');
    expect(() => execFileSync(process.execPath, [resolve(root, 'scripts/setup-prod.mjs')], { stdio: 'pipe' })).toThrow();
    expect(read(root, '.env.prod').PROVIDER_GAS_ENCRYPTION_KEY).toBe('invalid-existing-key');
  });
});
