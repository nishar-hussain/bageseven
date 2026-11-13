/** Disposable PostgreSQL + Anvil; no public payments or application rows. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import solc from 'solc';
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createDb, mandates, agents } from '../packages/db/dist/index.js';
import { BagMandateAbi, MandateClient, ProviderGasManager, workerKey } from '../packages/onchain/dist/index.js';
import { BagMandateBytecode } from '../packages/onchain/dist/bytecode.js';
import { MemoryGrantStore } from '../packages/entitlements/dist/index.js';
import { X402Authorities } from '../services/daemon/src/x402-authorities.ts';
import { X402Payments } from '../services/daemon/src/x402-payments.ts';
import { verifySettlement } from '../services/policy/src/settlement-proof.ts';
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Pool } = require('pg'), { migrate } = require('drizzle-orm/node-postgres/migrator');
const configured = process.env.DATABASE_URL;
if (!configured || !['localhost', '127.0.0.1'].includes(new URL(configured).hostname)) throw Error('Requires local DATABASE_URL');
const name = `bagseven_x402_test_${Date.now().toString(36)}`;
const admin = new Pool({ connectionString: configured });
const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const anvil = spawn('anvil', ['--port', String(port), '--chain-id', '43113', '--silent'], { stdio: 'ignore' });
const rpc = `http://127.0.0.1:${port}`;
const chain = defineChain({ id: 43113, name: 'Isolated', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(rpc) });
const owner = privateKeyToAccount(generatePrivateKey()), merchant = privateKeyToAccount(generatePrivateKey());
const wallet = account => createWalletClient({ account, chain, transport: http(rpc) });
const mine = async hash => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; };
let db, created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  const dbUrl = new URL(configured); dbUrl.pathname = `/${name}`;
  db = createDb({ connectionString: dbUrl.toString(), max: 10 });
  await migrate(db, { migrationsFolder: 'packages/db/drizzle' });
  for (let i = 0; i < 60; i++) { try { await client.getChainId(); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  await test.setBalance({ address: owner.address, value: parseEther('100') });
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Token.sol': { content: await readFile('scripts/contracts/LocalUSDC.sol', 'utf8') } },
    settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const artifact = compiled.contracts['Token.sol'].LocalUSDC;
  const token = (await mine(await wallet(owner).deployContract({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))).contractAddress;
  const env = { AVALANCHE_NETWORK: 'fuji', AVALANCHE_CHAIN_ID: '43113', CHAIN_ID: '43113', AVALANCHE_RPC_URL: rpc, RPC_URL: rpc,
    AVALANCHE_USDC: token, AVALANCHE_CONFIRMATIONS: '1', PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32),
    X402_PAYMENT_ENCRYPTION_KEY: 'cd'.repeat(32), DEV_MODE: 'true', PROVIDER_FUNDED_GAS: 'true' };
  const provider = 'x402-provider@example.com', mandateId = randomUUID(), worker = randomUUID();
  const gas = new ProviderGasManager(db, env);
  const preparedGas = await gas.prepare(provider, { owner: owner.address, avalancheBudget: '1', registryBudget: '1',
    avalancheTxLimit: '0.05', registryTxLimit: '0.05', expires: Date.now() + 90 * 86400000 });
  await gas.authorize(provider, await owner.signMessage({ message: preparedGas.message }));
  const enforcer = preparedGas.authorization.address;
  await mine(await wallet(owner).sendTransaction({ to: enforcer, value: parseEther('2') }));
  const vault = (await mine(await wallet(owner).deployContract({ abi: BagMandateAbi, bytecode: BagMandateBytecode,
    args: [owner.address, owner.address, enforcer, token, 10000000n, 86400n, 10000000n, 2000000n, 10000n, 2, workerKey(worker), 10000000n] }))).contractAddress;
  await mine(await wallet(owner).writeContract({ address: token, abi: artifact.abi, functionName: 'mint', args: [vault, 10000000n] }));
  await db.insert(mandates).values({ id: mandateId, providerId: provider, ownerAddress: owner.address.toLowerCase(), operatorAddress: owner.address.toLowerCase(),
    contractAddress: vault, budgetPerWindow: '10', windowSeconds: 86400, lifetimeCap: '10', perPurchaseCap: '2', perSellerPct: 10000, maxDepth: 2, signature: 'local-test' });
  await db.insert(agents).values({ id: worker, mandateId, operatorAddress: owner.address.toLowerCase(), sharePercent: '100', allocation: '10' });
  const grants = new MemoryGrantStore();
  const grant = await grants.mint({ holder: owner.address.toLowerCase(), merchant: provider, feature: 'research_fetch', remaining: '10', ttl_seconds: 86400, worker_id: worker });
  let settled = 0, released = 0, fundCalls = 0, mode = 'pay', crash = false;
  const transfer = async payload => {
    const { authorization: a, signature } = payload.payload;
    const sig = signature.slice(2);
    const hash = await wallet(owner).writeContract({ address: token, abi: artifact.abi, functionName: 'transferWithAuthorization',
      args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce,
        parseInt(sig.slice(128, 130), 16), `0x${sig.slice(0, 64)}`, `0x${sig.slice(64, 128)}`] });
    await mine(hash); return hash;
  };
  const facilitator = { url: 'https://test-facilitator.invalid', supports: async () => true, verify: async () => {},
    settle: async payload => ({ transaction: await transfer(payload), network: 'eip155:43113' }) };
  const authorities = new X402Authorities(db, env, { facilitator });
  const challenge = await authorities.prepare(provider, { mandate_id: mandateId, worker_id: worker, merchant: merchant.address,
    provider_origin: 'https://resource.example', max_amount: '1', expires: Date.now() + 86400000 });
  await assert.rejects(authorities.authorize(provider, challenge.authority_id, await merchant.signMessage({ message: challenge.message })), /SIGNATURE_INVALID/);
  await authorities.authorize(provider, challenge.authority_id, await owner.signMessage({ message: challenge.message }));
  await assert.rejects(authorities.authorize(provider, challenge.authority_id, await owner.signMessage({ message: challenge.message })), /CHALLENGE_REQUIRED/);
  const payer = challenge.terms.payer;
  let service;
  const fund = async (job, hooks) => {
    fundCalls++;
    const reservation = randomUUID(); await hooks.reserved(reservation);
    const account = await gas.account(provider, 'avalanche', { journal: hooks.journal });
    const signer = crash ? { ...account, signTransaction: async (...args) => { await account.signTransaction(...args); throw Error('simulated crash after journal before broadcast'); } } : account;
    const executor = new MandateClient(signer, { rpcUrl: rpc, chainId: 43113 });
    return { decision: 'allow', reservation_id: reservation, tx_hash: await executor.execute(vault, BigInt(job.data.amount), payer, workerKey(worker)) };
  };
  const fetcher = async (_url, init) => {
    const payload = JSON.parse(Buffer.from(init.headers['PAYMENT-SIGNATURE'], 'base64').toString());
    if (mode === 'pay') await transfer(payload);
    if (mode === 'lost-response') { await transfer(payload); throw Error('connection lost after settlement'); }
    return new Response('resource result', { status: 200 });
  };
  const create = () => new X402Payments(authorities, grants, fund, { settle: async () => { settled++; }, release: async () => { released++; } }, fetcher);
  service = create();
  const requirement = { x402Version: 2, scheme: 'exact', network: 'eip155:43113', asset: token, payTo: merchant.address, amount: '1000000', maxTimeoutSeconds: 60 };
  const prepare = key => service.prepare(provider, worker, 'https://resource.example/api', requirement, key, grant.id);
  await assert.rejects(service.prepare(provider, worker, 'https://evil.example/api', requirement, 'wrong-origin', grant.id), /SCOPE_MISMATCH/);
  await assert.rejects(service.prepare(provider, worker, 'https://resource.example/api', { ...requirement, amount: '2000000' }, 'too-much', grant.id), /SCOPE_MISMATCH/);
  const first = await prepare('first');
  assert.equal(await prepare('first'), first);
  await assert.rejects(prepare('another'), /PAYER_BUSY/);
  await Promise.all([service.process(first), service.process(first)]);
  assert.equal((await service.view(first)).status, 'SETTLED'); assert.equal(fundCalls, 1);
  await service.process(first); assert.equal(fundCalls, 1);
  assert.equal((await grants.get(grant.id)).remaining, '9');
  const firstJob = await service.store.get(first);
  const proof = { chain: 43113, confirmations: 1, hash: firstJob.data.fundingHash, vault, token, recipient: payer, worker, amount: 1000000n };
  await verifySettlement(client, proof);
  await assert.rejects(verifySettlement(client, { ...proof, recipient: merchant.address }), /CALL_MISMATCH/);
  await assert.rejects(verifySettlement(client, { ...proof, worker: randomUUID() }), /CALL_MISMATCH/);
  await assert.rejects(verifySettlement(client, { ...proof, chain: 43114 }), /CHAIN_MISMATCH/);
  assert.equal(await client.readContract({ address: token, abi: artifact.abi, functionName: 'balanceOf', args: [merchant.address] }), 1000000n);
  console.log('PASS provider approval, origin/amount restrictions, idempotency, concurrency, real mandate funding and EIP-3009 settlement');
  mode = 'lost-response'; const lost = await prepare('lost'); await service.process(lost);
  assert.equal((await service.view(lost)).status, 'RECONCILIATION_REQUIRED');
  service = create(); await service.process(lost);
  assert.equal((await service.view(lost)).status, 'SETTLED'); assert.equal(fundCalls, 2);
  console.log('PASS restart reconciles settlement after lost HTTP response without another payment or funding');
  mode = 'no-settlement'; const refund = await prepare('refund'); await service.process(refund);
  assert.equal((await service.view(refund)).status, 'SUBMITTED', 'HTTP 200 must not prove payment');
  await authorities.revoke(provider, challenge.authority_id);
  const signed = await service.store.get(refund);
  await test.setNextBlockTimestamp({ timestamp: BigInt(signed.data.authorization.validBefore) + 1n }); await test.mine({ blocks: 1 });
  await service.process(refund); await service.process(refund);
  assert.equal((await service.view(refund)).status, 'REFUNDED');
  assert.equal((await grants.get(grant.id)).remaining, '8');
  assert.equal(await client.readContract({ address: vault, abi: BagMandateAbi, functionName: 'lifetimeSpent' }), 3000000n);
  assert.equal(await client.readContract({ address: token, abi: artifact.abi, functionName: 'balanceOf', args: [payer] }), 0n);
  await assert.rejects(prepare('revoked'), /APPROVAL_REQUIRED/);
  console.log('PASS HTTP success is insufficient, revocation blocks new jobs, expired unused signature refunds only its original vault; quota remains consumed');
  const renewed = await authorities.prepare(provider, { mandate_id: mandateId, worker_id: worker, merchant: merchant.address,
    provider_origin: 'https://resource.example', max_amount: '1', expires: Date.now() + 86400000 });
  assert.equal(renewed.terms.payer, payer, 'renewal must not reset per-recipient caps');
  await authorities.authorize(provider, renewed.authority_id, await owner.signMessage({ message: renewed.message }));
  mode = 'pay'; crash = true; const interrupted = await prepare('interrupted'); await service.process(interrupted);
  assert.equal((await service.view(interrupted)).status, 'RECONCILIATION_REQUIRED');
  const raw = (await service.store.get(interrupted)).data.fundingRaw; assert.ok(raw);
  crash = false; service = create();
  await service.process(interrupted); await service.process(interrupted); await service.process(interrupted);
  assert.equal((await service.view(interrupted)).status, 'SETTLED'); assert.equal(fundCalls, 4);
  assert.equal((await service.store.get(interrupted)).data.fundingRaw, raw);
  console.log('PASS crash after signing recovers exact journaled funding bytes; stable payer preserves on-chain recipient accounting');
} finally {
  if (db) await db.$client.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end(); anvil.kill('SIGTERM');
}
