#!/usr/bin/env node
/** User-approved gas deposit from an encrypted deployment keystore. No app wallet key. */
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';
import { createPublicClient, http, formatEther, parseEther } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { createDb } from '@bagseven/db';
import { FUJI_DEPLOYMENT, ProviderGasManager, assertPublicFuji, verifyFujiRegistry } from '@bagseven/onchain';
import { keystoreOwner } from './foundry-keystore.mjs';
import { validateFujiGasFunding } from './fuji-gas-validation.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  dir = resolve(root, '.data/fuji');
const keyFile = resolve(root, '.data/keystores/bagseven-fuji'),
  journalFile = resolve(dir, 'gas-funding-journal.json');
const action = process.argv[2] ?? 'plan';
const client = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_DEPLOYMENT.rpcUrl) });
let db, lock;
async function save(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(data, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  const folder = await open(dirname(file), 'r');
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}
async function confirm(message) {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw Error('Review and approve funding in your own terminal; never send a password in chat');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    if ((await rl.question(message + '\nType FUND FUJI GAS to approve: ')).trim() !== 'FUND FUJI GAS')
      throw Error('Funding cancelled');
  } finally {
    rl.close();
  }
}
try {
  if (!['plan', 'fund', 'resume', 'status'].includes(action))
    throw Error('Usage: pnpm fuji:gas plan|fund|resume|status [provider email]');
  const env = parseEnv(await readFile(resolve(root, '.env'), 'utf8'));
  if (
    env.DEV_MODE !== 'false' ||
    env.AVALANCHE_RPC_URL !== FUJI_DEPLOYMENT.rpcUrl ||
    new URL(env.DATABASE_URL).pathname !== '/bagseven_fuji'
  )
    throw Error('Select the verified public Fuji runtime first');
  await assertPublicFuji(client);
  const manifest = JSON.parse(await readFile(resolve(dir, 'registry.json'), 'utf8'));
  const verified = await verifyFujiRegistry(client, manifest.transaction, manifest.owner);
  if (verified.address.toLowerCase() !== env.AVALANCHE_ENTITLEMENT_REGISTRY.toLowerCase())
    throw Error('Registry manifest mismatch');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  db = createDb({ connectionString: env.DATABASE_URL });
  const manager = new ProviderGasManager(db, env);
  const selected = process.argv[3];
  const candidates = await db.$client.query(
    "select provider_id from provider_gas_accounts where status='active' and expires_at>now()",
  );
  const provider = selected ?? (candidates.rows.length === 1 ? candidates.rows[0].provider_id : null);
  if (!provider)
    throw Error(
      'Authorize provider gas in the dashboard first; specify the provider email if more than one is active',
    );
  const permission = await manager.assertActive(provider);
  const from = await keystoreOwner(keyFile, async () => {
    throw Error('Run pnpm fuji:registry account in your terminal first');
  });
  let journal;
  try {
    journal = JSON.parse(await readFile(journalFile, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  async function checkJournal() {
    if (
      journal.plan.provider !== provider ||
      journal.plan.owner.toLowerCase() !== from.toLowerCase() ||
      journal.plan.to.toLowerCase() !== permission.address.toLowerCase()
    )
      throw Error('Funding journal belongs to another permission');
    if ((await validateFujiGasFunding(journal.plan, journal.raw)) !== journal.hash)
      throw Error('Funding journal mismatch');
  }
  async function verifyReceipt() {
    const receipt = await client.waitForTransactionReceipt({
      hash: journal.hash,
      confirmations: 2,
      timeout: 90000,
    });
    if (receipt.status !== 'success') throw Error('Funding transaction reverted');
    console.log(
      `Verified funding transaction: ${journal.hash}\nProvider gas address: ${permission.address}\nCurrent balance: ${formatEther(await client.getBalance({ address: permission.address }))} AVAX`,
    );
  }
  if (action === 'status') {
    if (journal) {
      await checkJournal();
      await verifyReceipt();
    } else {
      const balance = await client.getBalance({ address: permission.address });
      console.log(`Public Fuji (43113)\nProvider gas authorization: active\nProvider gas address: ${permission.address}\nCurrent balance: ${formatEther(balance)} AVAX\nNo deposit was recorded by this funding tool. External transfers are reflected in the balance above; a positive balance does not verify a particular deposit.`);
      if (balance === 0n) console.log('No gas funds are available. To review and approve a deposit in your own terminal: pnpm fuji:gas fund');
    }
  } else {
    lock = await open(resolve(dir, 'gas-funding.lock'), 'wx', 0o600);
    if (action === 'resume') {
      if (!journal) throw Error('No funding journal exists');
      await checkJournal();
      await confirm(`Resume only the approved deposit ${journal.hash}`);
    } else {
      if (journal)
        throw Error('A funding journal already exists. Use status or resume; refusing a duplicate deposit');
      const value = parseEther('0.05');
      const [nonce, estimate, fees, balance] = await Promise.all([
        client.getTransactionCount({ address: from, blockTag: 'pending' }),
        client.estimateGas({ account: from, to: permission.address, value }),
        client.estimateFeesPerGas(),
        client.getBalance({ address: from }),
      ]);
      const plan = {
        kind: 'bagseven_fuji_gas_v1',
        chainId: 43113,
        provider,
        owner: from,
        to: permission.address,
        nonce,
        value: String(value),
        gas: String((estimate * 125n) / 100n),
        maxFeePerGas: String(fees.maxFeePerGas),
        maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
      };
      const cap = BigInt(plan.gas) * BigInt(plan.maxFeePerGas);
      console.log(
        `Public Fuji (43113)\nFrom deployment keystore: ${from}\nDedicated provider gas address: ${plan.to}\nAmount: 0.05 AVAX\nMaximum additional network fee: ${formatEther(cap)} AVAX\nOwner balance: ${formatEther(balance)} AVAX\nNo stablecoin allowance, vault access or spending mandate is granted by this deposit.`,
      );
      if (balance < value + cap) throw Error('Insufficient public Fuji AVAX');
      if (action === 'plan') {
        console.log('Read-only funding plan. To approve locally: pnpm fuji:gas fund');
        process.exitCode = 0;
      } else {
        await confirm('Approve this exact native AVAX deposit to the provider’s authorized gas account.');
        if ((await client.getTransactionCount({ address: from, blockTag: 'pending' })) !== nonce)
          throw Error('Account nonce changed. Review a fresh funding plan');
        const safeEnv = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !/^(ETH_|CAST_|PRIVATE_KEY|MNEMONIC|.*PASSWORD)/i.test(key),
          ),
        );
        const raw = await new Promise((done, reject) => {
          const child = spawn(
            'cast',
            [
              'mktx',
              plan.to,
              '--rpc-url',
              FUJI_DEPLOYMENT.rpcUrl,
              '--chain',
              '43113',
              '--keystore',
              keyFile,
              '--nonce',
              String(nonce),
              '--gas-limit',
              plan.gas,
              '--gas-price',
              plan.maxFeePerGas,
              '--priority-gas-price',
              plan.maxPriorityFeePerGas,
              '--value',
              plan.value,
            ],
            { cwd: root, env: safeEnv, stdio: ['inherit', 'pipe', 'inherit'] },
          );
          let output = '';
          child.stdout.on('data', (chunk) => {
            output += chunk;
          });
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0 ? done(output.trim()) : reject(Error('Foundry signing failed; no broadcast')),
          );
        });
        journal = { plan, raw, hash: await validateFujiGasFunding(plan, raw) };
        await save(journalFile, journal);
      }
    }
    if (journal) {
      await checkJournal();
      let known = false;
      try {
        await client.getTransaction({ hash: journal.hash });
        known = true;
      } catch (e) {
        if (e.name !== 'TransactionNotFoundError') throw e;
      }
      if (!known) await client.sendRawTransaction({ serializedTransaction: journal.raw });
      console.log(`Funding submitted: ${journal.hash}. If interrupted, use pnpm fuji:gas resume.`);
      await verifyReceipt();
    }
  }
} catch (error) {
  console.error(`Fuji gas funding: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (lock) {
    await lock.close();
    await unlink(resolve(dir, 'gas-funding.lock'));
  }
  await db?.$client.end();
}
