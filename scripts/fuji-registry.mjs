#!/usr/bin/env node
// Run interactively in your own terminal. Never pass a private key or password.
import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { mkdir, readFile, rename, stat, chmod, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createPublicClient, http, formatEther } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { FUJI_DEPLOYMENT, EntitlementRegistryBytecode, prepareFujiRegistry, validateSignedRegistry, verifyFujiRegistry, assertPublicFuji } from '@bagseven/onchain';
import { keystoreOwner } from './foundry-keystore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '.data/fuji');
const keys = resolve(root, '.data/keystores');
const keyFile = resolve(keys, 'bagseven-fuji');
const journalFile = resolve(dir, 'registry-journal.json');
const client = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_DEPLOYMENT.rpcUrl) });
const action = process.argv[2] ?? 'help';
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ETH_|CAST_|PRIVATE_KEY|MNEMONIC|.*PASSWORD)/i.test(k)));
async function save(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
  const folder = await open(dirname(file), 'r');
  try { await folder.sync(); } finally { await folder.close(); }
}
function cast(args, capture = false) {
  return new Promise((done, reject) => {
    const child = spawn('cast', args, { cwd: root, env: safeEnv, stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done(output.trim()) : reject(Error('Foundry command failed; no new transaction was broadcast by this command.')));
  });
}
async function owner(importedAddress) {
  return keystoreOwner(keyFile, async () => {
    if (importedAddress) return importedAddress;
    if (!process.stdin.isTTY) throw Error('This valid Foundry keystore omits its public address. Run pnpm fuji:registry account in your own terminal to record it; no transaction is sent.');
    console.error('Foundry needs your password once to recover the public address omitted from this keystore. No transaction will be signed.');
    return cast(['wallet', 'address', '--keystore', keyFile], true);
  });
}
async function show(plan) {
  const balance = await client.getBalance({ address: plan.owner });
  const cap = BigInt(plan.gas) * BigInt(plan.maxFeePerGas);
  console.log(`Public Avalanche Fuji (43113)\nRPC: ${FUJI_DEPLOYMENT.rpcUrl}\nOwner: ${plan.owner}\nBalance: ${formatEther(balance)} AVAX\nOperation: deploy Bagseven entitlement registry; transfer 0 AVAX\nNonce: ${plan.nonce}\nMaximum gas fee: ${formatEther(cap)} AVAX\nCreation bytecode hash: ${plan.bytecodeHash}`);
  if (balance < cap) throw Error('Insufficient public Fuji AVAX for the maximum deployment fee.');
}
async function confirm(message) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw Error('Use your own interactive terminal for key import and deployment approval.');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { if ((await rl.question(`${message}\nType DEPLOY FUJI REGISTRY to continue: `)).trim() !== 'DEPLOY FUJI REGISTRY') throw Error('Deployment cancelled.'); }
  finally { rl.close(); }
}
async function settle(journal) {
  await assertPublicFuji(client);
  const expected = await validateSignedRegistry(journal.plan, journal.raw);
  if (expected.hash !== journal.hash || expected.address.toLowerCase() !== journal.address.toLowerCase()) throw Error('Deployment journal mismatch.');
  // Re-submit only the same signed bytes, never make a replacement deployment.
  let known = false;
  try { await client.getTransaction({ hash: journal.hash }); known = true; } catch (error) { if (error.name !== 'TransactionNotFoundError') throw error; }
  if (!known) await client.sendRawTransaction({ serializedTransaction: journal.raw });
  console.log(`Transaction: ${journal.hash}\nWaiting for two confirmations. If interrupted, run: pnpm fuji:registry resume`);
  await client.waitForTransactionReceipt({ hash: journal.hash, confirmations: 2, timeout: 90_000 });
  const manifest = await verifyFujiRegistry(client, journal.hash, journal.plan.owner);
  await save(resolve(dir, 'registry.json'), manifest);
  console.log(`Verified registry: ${manifest.address}\nPublic deployment details saved in .data/fuji/registry.json.\nThe existing Anvil platform configuration has not been changed.`);
}
let lock;
try {
  if (!['import', 'account', 'plan', 'deploy', 'resume', 'status', 'verify'].includes(action)) {
    console.log('Usage: pnpm fuji:registry import|account|plan|deploy|resume|status [public-owner-address for plan]\nOr: pnpm fuji:registry verify <public-transaction-hash> <public-owner-address>\nRequires Foundry cast for key operations. Never pass secrets as arguments.');
  } else {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await mkdir(keys, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700); await chmod(keys, 0o700);
    if (action === 'account') {
      console.log(`Encrypted keystore account: ${await owner()}. No transaction was signed or sent.`);
    } else if (action === 'verify') {
      const [hash, address] = process.argv.slice(3);
      if (!/^0x[\da-f]{64}$/i.test(hash ?? '') || !/^0x[\da-f]{40}$/i.test(address ?? '')) throw Error('Supply the public transaction hash and public deploying wallet address.');
      const manifest = await verifyFujiRegistry(client, hash, address);
      const path = resolve(dir, 'registry.json');
      try {
        const prior = JSON.parse(await readFile(path, 'utf8'));
        if (prior.transaction.toLowerCase() !== hash.toLowerCase()) throw Error('Another registry is already selected in the deployment manifest. Refusing replacement.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await save(path, manifest);
      console.log(`Verified public Fuji registry: ${manifest.address}. Run pnpm fuji:prepare to update the production imports.`);
    } else if (action === 'plan') {
      const address = process.argv[3] ?? await owner();
      await show(await prepareFujiRegistry(client, address));
    } else if (action === 'status') {
      const journal = JSON.parse(await readFile(journalFile, 'utf8'));
      console.log(JSON.stringify(await verifyFujiRegistry(client, journal.hash, journal.plan.owner), null, 2));
    } else {
      lock = await open(resolve(dir, 'deployment.lock'), 'wx', 0o600);
      if (action === 'import') {
        if (!process.stdin.isTTY) throw Error('Import the key only in your own terminal.');
        let importedAddress;
        let exists = false;
        try { await stat(keyFile); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!exists) {
          const output = await cast(['wallet', 'import', 'bagseven-fuji', '--keystore-dir', keys, '--interactive'], true);
          importedAddress = output.match(/Address:\s*(0x[a-f\d]{40})/i)?.[1];
          await chmod(keyFile, 0o600);
        }
        console.log(`Encrypted keystore ${exists ? 'already exists' : 'imported'} for ${await owner(importedAddress)}. Keep the password and key out of chat and Git.`);
      } else if (action === 'resume') {
        const journal = JSON.parse(await readFile(journalFile, 'utf8'));
        await confirm(`Resume the previously approved transaction ${journal.hash}; no new signature or payment is created.`);
        await settle(journal);
      } else {
        try { await stat(journalFile); throw Error('A deployment journal already exists. Use status or resume; refusing a second deployment.'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const plan = await prepareFujiRegistry(client, await owner());
        await show(plan);
        await confirm('Approve this exact deployment. Foundry will prompt for your keystore password.');
        if (await client.getTransactionCount({ address: plan.owner, blockTag: 'pending' }) !== plan.nonce) throw Error('Account nonce changed. Run deploy again to review a fresh plan.');
        const raw = await cast(['mktx', '--rpc-url', FUJI_DEPLOYMENT.rpcUrl, '--chain', '43113', '--keystore', keyFile,
          '--nonce', String(plan.nonce), '--gas-limit', plan.gas, '--gas-price', plan.maxFeePerGas,
          '--priority-gas-price', plan.maxPriorityFeePerGas, '--value', '0', '--create', EntitlementRegistryBytecode], true);
        if (!/^0x[\da-f]+$/i.test(raw)) throw Error('Unexpected signing output; refusing broadcast.');
        const expected = await validateSignedRegistry(plan, raw);
        const journal = { plan, raw, ...expected };
        await save(journalFile, journal);
        await settle(journal);
      }
    }
  }
} catch (error) {
  console.error(`Fuji deployment: ${error.message}`);
  if (error.code === 'EEXIST') console.error('Another command may be running. After checking it has stopped, remove .data/fuji/deployment.lock and use resume.');
  process.exitCode = 1;
} finally {
  if (lock) { await lock.close(); await unlink(resolve(dir, 'deployment.lock')); }
}
