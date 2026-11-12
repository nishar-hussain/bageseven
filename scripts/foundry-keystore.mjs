import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, writeFile, rename } from 'node:fs/promises';

export function encryptedKeystoreAddress(key) {
  const crypto = key?.crypto ?? key?.Crypto;
  if (key?.version !== 3 || !crypto || crypto.cipher !== 'aes-128-ctr' ||
    !/^[a-f\d]{64}$/i.test(crypto.ciphertext ?? '') || !/^[a-f\d]{32}$/i.test(crypto.cipherparams?.iv ?? '') ||
    !/^[a-f\d]{64}$/i.test(crypto.mac ?? '') || !['scrypt', 'pbkdf2'].includes(crypto.kdf) || !crypto.kdfparams) {
    throw Error('Expected an encrypted V3 Foundry keystore.');
  }
  // Address is optional in Ethereum V3 files, including Foundry's current output.
  if (key.address === undefined) return undefined;
  if (typeof key.address !== 'string' || !/^(0x)?[a-f\d]{40}$/i.test(key.address)) throw Error('Invalid public address in encrypted keystore.');
  return `0x${key.address.replace(/^0x/i, '')}`;
}

export async function loadKeystoreIdentity(path) {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw Error('Keystore must be a private file (chmod 600).');
  const contents = await readFile(path, 'utf8');
  const address = encryptedKeystoreAddress(JSON.parse(contents));
  return { address, fingerprint: createHash('sha256').update(contents).digest('hex') };
}

export async function keystoreOwner(path, resolveAddress) {
  const identity = await loadKeystoreIdentity(path);
  if (identity.address) return identity.address;
  const metadataPath = `${path}.address.json`;
  try {
    const cached = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (cached.fingerprint === identity.fingerprint && /^0x[a-f\d]{40}$/i.test(cached.address ?? '')) return cached.address;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const address = await resolveAddress();
  if (typeof address !== 'string' || !/^0x[a-f\d]{40}$/i.test(address)) throw Error('Foundry did not return a public wallet address.');
  const temp = `${metadataPath}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ address, fingerprint: identity.fingerprint }) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, metadataPath);
  return address;
}
