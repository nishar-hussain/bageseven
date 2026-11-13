import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptedKeystoreAddress, keystoreOwner } from './foundry-keystore.mjs';

// Synthetic ciphertext only; no private key or password is used by these tests.
const v3 = { version: 3, id: 'fixture', crypto: { cipher: 'aes-128-ctr', ciphertext: 'ab'.repeat(32),
  cipherparams: { iv: 'cd'.repeat(16) }, mac: 'ef'.repeat(32), kdf: 'scrypt', kdfparams: { n: 8192, r: 8, p: 1, dklen: 32, salt: 'ff'.repeat(32) } } };
const address = `0x${'11'.repeat(20)}`;
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('Foundry V3 keystore compatibility', () => {
  it('accepts Foundry files without an embedded address', () => expect(encryptedKeystoreAddress(v3)).toBeUndefined());
  it('accepts an embedded public address but rejects malformed or plaintext files', () => {
    expect(encryptedKeystoreAddress({ ...v3, address: address.slice(2) })).toBe(address);
    expect(() => encryptedKeystoreAddress({ version: 3, privateKey: 'do-not-accept' })).toThrow('encrypted V3');
    expect(() => encryptedKeystoreAddress({ ...v3, address: 'invalid' })).toThrow('public address');
  });
  it('resolves an omitted address once and invalidates metadata when the keystore changes', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'bagseven-keystore-')); folders.push(folder);
    const path = join(folder, 'account');
    await writeFile(path, JSON.stringify(v3), { mode: 0o600 });
    const resolver = vi.fn(async () => address);
    expect(await keystoreOwner(path, resolver)).toBe(address);
    expect(await keystoreOwner(path, resolver)).toBe(address);
    expect(resolver).toHaveBeenCalledTimes(1);
    await writeFile(path, JSON.stringify({ ...v3, id: 'different-keystore' }));
    await keystoreOwner(path, resolver);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
