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
  it('assigns the combined public port when embedded MCP is selected', () => {
    const root = fixture();
    mkdirSync(resolve(root, '.railway'));
    writeFileSync(resolve(root, '.railway/deployment.json'), '{"embeddedMcp":true}');
    run(root);
    const daemon = read(root, 'services/daemon/.env.prod');
    expect(daemon.PORT).toBe('4009');
    expect(daemon.BAGSEVEN_MCP_EMBEDDED).toBe('true');
    expect(daemon.MCP_OAUTH_REQUIRED).toBe('true');
  });
  it('includes database/cache references in shared and individual Railway import files', () => {
    const root = fixture();
    run(root);
    const shared = read(root, '.railway/.env.prod');
    expect(shared.DATABASE_URL).toBe('${{Postgres.DATABASE_URL}}');
    expect(shared.REDIS_URL).toBe('${{Redis.REDIS_URL}}');
    for (const service of ['daemon', 'gateway', 'policy']) {
      const env = read(root, `services/${service}/.env.prod`);
      expect(env.DATABASE_URL).toBe(shared.DATABASE_URL);
      expect(env.REDIS_URL).toBe(shared.REDIS_URL);
    }
    expect(read(root, 'apps/console/.env.prod').DATABASE_URL).toBeUndefined();
    expect(read(root, 'apps/console/.env.prod').REDIS_URL).toBeUndefined();
  });
  it('restores blank connection references while preserving explicit credentials and updating hosted callbacks', () => {
    const root = fixture();
    writeFileSync(resolve(root, '.env.prod'), 'DATABASE_URL=\nREDIS_URL=\nNEXT_PUBLIC_CONSOLE_URL=https://bageseven-app.vercel.app/\nAUTH_SECRET=preserved-secret\n');
    run(root);
    expect(read(root, '.env.prod').DATABASE_URL).toBe('${{Postgres.DATABASE_URL}}');
    expect(read(root, '.env.prod').REDIS_URL).toBe('${{Redis.REDIS_URL}}');
    const consoleEnv = read(root, 'apps/console/.env.prod');
    expect(consoleEnv.AUTH_SECRET).toBe('preserved-secret');
    expect(consoleEnv.NEXT_PUBLIC_BAGSEVEN_API_URL).toBe('https://bageseven-app.vercel.app/api/public');
    writeFileSync(resolve(root, '.env.prod'), 'DATABASE_URL=postgres://user:secret@custom.internal:5432/bag\nREDIS_URL=redis://:secret@cache.internal:6379\n');
    run(root);
    expect(read(root, 'services/daemon/.env.prod').DATABASE_URL).toBe('postgres://user:secret@custom.internal:5432/bag');
    expect(read(root, 'services/daemon/.env.prod').REDIS_URL).toBe('redis://:secret@cache.internal:6379');
  });
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
