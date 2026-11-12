#!/usr/bin/env node
/** Explicit, recoverable Anvil-only asset upgrade. Never changes old vault assets or customer consent. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import solc from 'solc';
import { createDb, mandates, agents, vaults } from '@bagseven/db';
import { BagMandateAbi, ProviderGasManager, canonicalMandate, workerKey, avalancheConfig } from '@bagseven/onchain';
import { BagMandateBytecode } from '../packages/onchain/dist/bytecode.js';
import { createPublicClient, createWalletClient, encodeDeployData, getContractAddress, http, keccak256, parseAbi, parseEther } from 'viem';
import { AvalancheGrantStore, configureProviderGrantSigners } from '@bagseven/entitlements';
import { Subscriptions } from '../services/daemon/dist/subscriptions.js';
import { PostgresSubscriptionStore } from '../services/daemon/dist/subscription-store.js';
import { AvalancheSubscriptionChain } from '../services/daemon/dist/subscription-chain.js';
import { privateKeyToAccount } from 'viem/accounts';
import { PostgresBillingStore } from '../services/daemon/dist/billing-store.js';

const root = resolve(import.meta.dirname, '..'), envPath = resolve(root, '.env');
const env = { ...parseEnv(readFileSync(envPath, 'utf8')) };
const config = avalancheConfig(env);
if (env.DEV_MODE !== 'true' || env.NODE_ENV === 'production' || config.rpcUrl !== 'http://localhost:58545' || config.chainId !== 43113) throw Error('This command only upgrades the explicitly configured local Anvil deployment');
const rpc = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
if (!(await rpc.request({ method: 'web3_clientVersion' })).toLowerCase().includes('anvil') || await rpc.getChainId() !== 43113) throw Error('Local Anvil required');
const owner = privateKeyToAccount(env.DAEMON_OWNER_KEY), operator = privateKeyToAccount(env.DAEMON_OPERATOR_KEY);
// Known development keys only; this is not a live deployment or a production custody bypass.
if (owner.address.toLowerCase() !== '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266') throw Error('Use the known local Anvil owner, never a real wallet');
const dbUrl = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname)) throw Error('Local PostgreSQL required');
const db = createDb({ connectionString: env.DATABASE_URL });
const path = resolve(root, '.data/local-x402-upgrade.json');
mkdirSync(resolve(root, '.data/local-config-backups'), { recursive: true });
let state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
const save = () => writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
function configureReceiptApp(provider) {
  let contents = readFileSync(envPath, 'utf8');
  for (const key of ['DEMO_PROVIDER_ID', 'DEMO_HOLDER']) {
    if (env[key] && !env[key].startsWith('world:')) continue;
    const line = `${key}=${JSON.stringify(provider)}`;
    const match = new RegExp(`^${key}=.*$`, 'm');
    contents = match.test(contents) ? contents.replace(match, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, contents, { mode: 0o600 });
}
const tokenAbi = parseAbi(['function mint(address,uint256)', 'function balanceOf(address) view returns(uint256)', 'function version() view returns(string)', 'function usdc() view returns(address)']);
async function mine(hash) { const r = await rpc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw Error('Local upgrade transaction reverted'); return r; }
async function deploy(label, account, data) {
  let prepared = state[label];
  if (!prepared) {
    const wallet = createWalletClient({ account, chain: config.chain, transport: http(config.rpcUrl) });
    const request = await wallet.prepareTransactionRequest({ account, data });
    const raw = await wallet.signTransaction(request);
    prepared = { raw, hash: keccak256(raw), address: getContractAddress({ from: account.address, nonce: BigInt(request.nonce) }) };
    state[label] = prepared; save(); // Exact signed bytes persist before broadcast.
  }
  if (!await rpc.getCode({ address: prepared.address })) {
    try { await rpc.sendRawTransaction({ serializedTransaction: prepared.raw }); }
    catch (e) { if (!/already known|nonce too low/i.test(String(e))) throw e; }
    await mine(prepared.hash);
  }
  return prepared.address;
}
try {
  if (state?.phase === 'complete') {
    if (config.usdt.toLowerCase() !== state.token.address.toLowerCase()) throw Error('Completed upgrade belongs to another configured token');
    const [tokenCode, rootWorker] = await Promise.all([
      rpc.getCode({ address: state.token.address }),
      rpc.readContract({ address: state.mandate.address, abi: BagMandateAbi, functionName: 'rootWorker' }).catch(() => null),
    ]);
    if (!tokenCode || rootWorker !== workerKey(state.workerId)) throw Error('The local chain was reset after this upgrade. Restore its saved Anvil state or explicitly prepare a new local deployment; existing history was not replayed');
    configureReceiptApp(state.provider);
    console.log('Local x402 upgrade already complete; no funds, plans or grants changed');
    await db.$client.end(); process.exit(0);
  }
  const active = await db.$client.query("select count(*) from billing_subscriptions where status not in ('CANCELLED','ENDED')");
  if (Number(active.rows[0].count)) throw Error('Active subscriptions require an explicit customer migration; no asset change performed');
  const pending = await db.$client.query("select count(*) from x402_jobs where state not in ('SETTLED','REFUNDED','REJECTED')");
  if (Number(pending.rows[0].count)) throw Error('Reconcile pending x402 allocations before changing the token');
  const providers = await db.$client.query("select provider_id from provider_gas_accounts where status='active'");
  if (providers.rows.length !== 1) throw Error('Expected exactly one explicitly prepared local provider');
  const provider = providers.rows[0].provider_id;
  const gas = new ProviderGasManager(db, env);
  const authorization = await gas.assertActive(provider);
  if (authorization.ownerAddress !== owner.address.toLowerCase()) throw Error('Provider authority must belong to the known Anvil owner');
  if (!state) {
    const stamp = Date.now();
    const backup = resolve(root, `.data/local-config-backups/x402-${stamp}`);
    mkdirSync(backup, { recursive: true });
    writeFileSync(`${backup}/env`, readFileSync(envPath), { mode: 0o600 });
    writeFileSync(`${backup}/anvil-state.json`, await rpc.request({ method: 'anvil_dumpState' }), { mode: 0o600 });
    const fd = openSync(`${backup}/database.sql`, 'wx', 0o600);
    try {
      const result = spawnSync('docker', ['exec', 'bagseven-postgres-1', 'pg_dump', '-U', dbUrl.username, dbUrl.pathname.slice(1)], { stdio: ['ignore', fd, 'pipe'] });
      if (result.status !== 0) throw Error('Local database backup failed; no upgrade performed');
    } finally { closeSync(fd); }
    state = { backup, provider, originalToken: config.usdt, mandateId: randomUUID(), workerId: randomUUID(), phase: 'prepared' }; save();
  }
  if (state.provider !== provider) throw Error('Upgrade journal belongs to a different provider');
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Token.sol': { content: readFileSync(resolve(root, 'scripts/contracts/LocalUSDC.sol'), 'utf8') } },
    settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi','evm.bytecode.object'] } } } })));
  if (compiled.errors?.some(e => e.severity === 'error')) throw Error('Local token compilation failed');
  const tokenArtifact = compiled.contracts['Token.sol'].LocalUSDC;
  const token = await deploy('token', owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}` }));
  if (await rpc.getBalance({ address: authorization.address }) < parseEther('0.1')) {
    const faucet = createWalletClient({ account: owner, chain: config.chain, transport: http(config.rpcUrl) });
    await mine(await faucet.sendTransaction({ to: authorization.address, value: parseEther('0.5') }));
  }
  if (!state.providerNonceAligned && !state.mandate) {
    const journal = await db.$client.query('select max(nonce) as nonce from provider_signed_transactions where provider_id=$1 and chain_id=43113', [provider]);
    const next = journal.rows[0].nonce === null ? 0 : Number(journal.rows[0].nonce) + 1;
    const current = await rpc.getTransactionCount({ address: authorization.address, blockTag: 'pending' });
    // Anvil may have been reset while PostgreSQL retained signed history. Never replay those old payments.
    // This development-only RPC restores the consumed nonce range; public networks cannot use it.
    if (current < next) await rpc.request({ method: 'anvil_setNonce', params: [authorization.address, `0x${next.toString(16)}`] });
    state.providerNonceAligned = true; save();
  }
  const signer = await gas.account(provider, 'avalanche');
  const terms = { owner: owner.address.toLowerCase(), operator: operator.address.toLowerCase(), budgetPerWindow: '100', windowSeconds: 86400,
    lifetimeCap: '1000', perPurchaseCap: '10', perSellerPct: 10000, maxDepth: 3, chainId: 43113 };
  const contract = await deploy('mandate', signer, encodeDeployData({ abi: BagMandateAbi, bytecode: BagMandateBytecode,
    args: [owner.address, operator.address, signer.address, token, 100000000n, 86400n, 1000000000n, 10000000n, 10000n, 3, workerKey(state.workerId), 1000000000n] }));
  const signature = await owner.signMessage({ message: canonicalMandate(terms) });
  const billing = new PostgresBillingStore(db);
  if (state.phase === 'prepared') {
    await db.transaction(async tx => {
      // Retire discovery entries only; old on-chain vaults, funds and subscription records remain untouched.
      await tx.execute((await import('../packages/db/node_modules/drizzle-orm/index.js')).sql`update mandates set status='superseded', superseded_at=now() where id <> ${state.mandateId} and status='active'`);
      await tx.insert(mandates).values({ id: state.mandateId, providerId: provider, ownerAddress: terms.owner, operatorAddress: terms.operator,
        contractAddress: contract.toLowerCase(), budgetPerWindow: '100', windowSeconds: 86400, lifetimeCap: '1000', perPurchaseCap: '10', perSellerPct: 10000, maxDepth: 3, signature }).onConflictDoNothing();
      await tx.insert(vaults).values({ mandateId: state.mandateId, contractAddress: contract }).onConflictDoNothing();
      await tx.insert(agents).values({ id: state.workerId, mandateId: state.mandateId, operatorAddress: terms.operator, sharePercent: '100', allocation: '1000', name: 'Avalanche local agent' }).onConflictDoNothing();
      await tx.execute((await import('../packages/db/node_modules/drizzle-orm/index.js')).sql`update billing_plans set active='false' where provider_id=${provider}`);
    });
    state.phase = 'mandate-ready'; save();
  }
  const wallet = createWalletClient({ account: owner, chain: config.chain, transport: http(config.rpcUrl) });
  // The Anvil-only faucet never moves any balance from an old vault.
  for (const address of [owner.address, operator.address, contract]) {
    if (await rpc.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [address] }) === 0n)
      await mine(await wallet.writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'mint', args: [address, 100000000n] }));
  }
  const plans = await billing.listPlans();
  for (const [name, amount, credits, interval] of [['Receipt Starter','1','5','once'],['Receipt Pro','10','100','month'],['Receipt Team','25','300','month']]) {
    if (!plans.some(p => p.provider_id === provider && p.active && p.name === name)) await billing.createPlan({ provider_id: provider, name, amount, credits, interval, feature: 'ocr', merchant_wallet: owner.address });
  }
  const upgradedEnv = { ...env, AVALANCHE_USDC: token, USDC_ADDRESS: token };
  const upgradedGas = new ProviderGasManager(db, upgradedEnv);
  configureProviderGrantSigners(id => upgradedGas.account(id, 'registry'));
  const grants = new AvalancheGrantStore(db, upgradedEnv);
  for (const [feature, remaining] of [['ocr','10'],['research_fetch','5'],['api_access','20']]) {
    if (!(await grants.findLive({ holder: provider, feature, worker_id: state.workerId })).length)
      await grants.mint({ merchant: provider, holder: provider, feature, remaining, worker_id: state.workerId,
        ttl_seconds: 30 * 86400, renewal_enabled: false, settlement_network: 'avalanche' });
  }
  const subscriptions = new Subscriptions(new PostgresSubscriptionStore(db), new AvalancheSubscriptionChain(upgradedGas, upgradedEnv), grants);
  for (const plan of await billing.listPlans(true)) {
    if (plan.provider_id !== provider || plan.interval !== 'month') continue;
    await subscriptions.prepare(plan);
    await rpc.request({ method: 'evm_mine', params: [] });
    if ((await subscriptions.prepare(plan)).status !== 'ready') throw Error('New monthly plan is not confirmed; resume the upgrade');
  }
  let contents = readFileSync(envPath, 'utf8');
  for (const [key,value] of Object.entries({ AVALANCHE_USDC: token, USDC_ADDRESS: token, NEXT_PUBLIC_AVALANCHE_USDC: token,
    LOCAL_MANDATE_ID: state.mandateId, BAGSEVEN_MCP_WORKER: state.workerId })) {
    const re = new RegExp(`^${key}=.*$`, 'm'); contents = re.test(contents) ? contents.replace(re, () => `${key}=${value}`) : `${contents.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(envPath, contents, { mode: 0o600 });
  configureReceiptApp(provider);
  state.phase = 'complete'; save();
  console.log(JSON.stringify({ token, mandate: contract, worker: state.workerId, backup: state.backup, oldVaultsPreserved: true }));
} finally { await db.$client.end(); }
