#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { createDb, agents, mandates, vaults } from '@bagseven/db';
import { MandateClient, canonicalMandate, chainForId, workerKey, EntitlementRegistryAbi, EntitlementRegistryBytecode, ProviderGasManager } from '@bagseven/onchain';
import { AvalancheGrantStore, configureProviderGrantSigners } from '@bagseven/entitlements';
import { createWalletClient, http, parseAbi, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
process.loadEnvFile(envPath);
const cfg = process.env;

async function main() {
  if (cfg.DEV_MODE !== 'true' || cfg.RPC_URL !== 'http://localhost:58545') {
    throw new Error('Local seed requires DEV_MODE=true and RPC_URL=http://localhost:58545');
  }
  const client = new MandateClient(cfg.DAEMON_EXECUTOR_KEY, { rpcUrl: cfg.RPC_URL, chainId: Number(cfg.CHAIN_ID) });
  const version = await client.publicClient.request({ method: 'web3_clientVersion' });
  if (!version.toLowerCase().includes('anvil')) throw new Error('Local seed requires Anvil');
  if (await client.publicClient.getChainId() !== Number(cfg.CHAIN_ID)) throw new Error('Local chain ID does not match CHAIN_ID');
  const executor = privateKeyToAccount(cfg.DAEMON_EXECUTOR_KEY);
  const owner = privateKeyToAccount(cfg.DAEMON_OWNER_KEY);
  const operator = privateKeyToAccount(cfg.DAEMON_OPERATOR_KEY);
  const chain = chainForId(Number(cfg.CHAIN_ID));
  const wallet = createWalletClient({ account: executor, chain, transport: http(cfg.RPC_URL) });
  const tokenAbi = parseAbi(['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)']);
  const wait = async (hash) => {
    const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('Local chain transaction reverted');
    return receipt;
  };
  // Generated development keys need not be Anvil's prefunded accounts.
  const faucet = createWalletClient({ account: owner, chain, transport: http(cfg.RPC_URL) });
  const fundedAccounts = [executor.address];
  if (cfg.BAGSEVEN_X402_PAYER_KEY) fundedAccounts.push(privateKeyToAccount(cfg.BAGSEVEN_X402_PAYER_KEY).address);
  for (const address of fundedAccounts) {
    if (await client.publicClient.getBalance({ address }) < 1_000_000_000_000_000_000n) {
      await wait(await faucet.sendTransaction({ to: address, value: 10_000_000_000_000_000_000n }));
    }
  }
  let token = cfg.USDC_ADDRESS;
  if (!token || !(await client.publicClient.getCode({ address: token }))) {
    const source = readFileSync(new URL('./contracts/LocalUSDC.sol', import.meta.url), 'utf8');
    const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'LocalUSDC.sol': { content: source } }, settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
    const errors = output.errors?.filter((error) => error.severity === 'error');
    if (errors?.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
    const compiled = output.contracts['LocalUSDC.sol'].LocalUSDC;
    token = (await wait(await wallet.deployContract({ abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` }))).contractAddress;
  }
  const balance = await client.publicClient.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [executor.address] });
  if (balance < 100_000_000n) await wait(await wallet.writeContract({ address: token, abi: tokenAbi, functionName: 'mint', args: [executor.address, 10_000_000_000n] }));
  let registry = cfg.AVALANCHE_ENTITLEMENT_REGISTRY;
  if (!registry || !(await client.publicClient.getCode({ address: registry }))) {
    registry = (await wait(await wallet.deployContract({ abi: EntitlementRegistryAbi, bytecode: EntitlementRegistryBytecode }))).contractAddress;
  }

  const db = createDb({ connectionString: cfg.DATABASE_URL });
  try {
    let worker = cfg.BAGSEVEN_MCP_WORKER && await db.query.agents.findFirst({ where: (row, { eq }) => eq(row.id, cfg.BAGSEVEN_MCP_WORKER) });
    let mandate = worker && await db.query.mandates.findFirst({ where: (row, { eq }) => eq(row.id, worker.mandateId) });
    if (mandate) {
      const root = await client.publicClient.readContract({ address: mandate.contractAddress, abi: parseAbi(['function rootWorker() view returns (bytes32)']), functionName: 'rootWorker' }).catch(() => undefined);
      if (root !== workerKey(worker.id) || mandate.status !== 'active') mandate = undefined;
    }
    if (!mandate) {
      const workerId = randomUUID();
      const input = { owner: owner.address.toLowerCase(), operator: operator.address.toLowerCase(), budgetPerWindow: '1000.00', windowSeconds: 86400, lifetimeCap: '10000.00', perPurchaseCap: '10.00', perSellerPct: 10000, maxDepth: 3, chainId: Number(cfg.CHAIN_ID) };
      const signature = await owner.signMessage({ message: canonicalMandate(input) });
      const contract = await client.deploy({ owner: owner.address, operator: operator.address, enforcer: executor.address, usdc: token, budgetPerWindow: 1_000_000_000n, windowSeconds: input.windowSeconds, lifetimeCap: 10_000_000_000n, perPurchaseCap: 10_000_000n, perSellerPct: input.perSellerPct, maxDepth: input.maxDepth, rootWorker: workerKey(workerId), rootAllocation: 10_000_000_000n });
      await db.transaction(async (tx) => {
        [mandate] = await tx.insert(mandates).values({ ownerAddress: input.owner, operatorAddress: input.operator, contractAddress: contract, budgetPerWindow: input.budgetPerWindow, windowSeconds: input.windowSeconds, lifetimeCap: input.lifetimeCap, perPurchaseCap: input.perPurchaseCap, perSellerPct: input.perSellerPct, maxDepth: input.maxDepth, signature, status: 'active' }).returning();
        await tx.insert(vaults).values({ mandateId: mandate.id, contractAddress: contract });
        [worker] = await tx.insert(agents).values({ id: workerId, mandateId: mandate.id, operatorAddress: input.operator, sharePercent: '100.00', allocation: input.lifetimeCap, depth: 0, status: 'active' }).returning();
      });
    }
    if (await client.vaultBalance(mandate.contractAddress) < 100_000_000n) await client.fund(mandate.contractAddress, token, 100_000_000n);
    let env = readFileSync(envPath, 'utf8');
    for (const [key, value] of Object.entries({
      USDC_ADDRESS: token,
      AVALANCHE_USDC: token,
      AVALANCHE_ENTITLEMENT_REGISTRY: registry,
      ENTITLEMENT_STORE: 'avalanche',
      ENTITLEMENT_SUBJECT_SECRET: cfg.ENTITLEMENT_SUBJECT_SECRET || randomBytes(32).toString('hex'),
      NEXT_PUBLIC_AVALANCHE_USDC: token,
      AVALANCHE_RPC_URL: cfg.RPC_URL,
      NEXT_PUBLIC_AVALANCHE_RPC_URL: cfg.RPC_URL,
      NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL: cfg.RPC_URL,
      LOCAL_MANDATE_ID: mandate.id,
      BAGSEVEN_MCP_WORKER: worker.id,
    })) {
      const re = new RegExp(`^${key}=.*$`, 'm');
      env = re.test(env) ? env.replace(re, () => `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
    }
    writeFileSync(envPath, env);
    // Optional, explicitly selected workspace. All signatures and funds are Anvil-only.
    if (cfg.LOCAL_PROVIDER_EMAIL) {
      const provider = cfg.LOCAL_PROVIDER_EMAIL.trim().toLowerCase();
      const localEnv = { ...cfg, AVALANCHE_ENTITLEMENT_REGISTRY: registry, AVALANCHE_USDC: token,
        AVALANCHE_RPC_URL: cfg.RPC_URL, ENTITLEMENT_SUBJECT_SECRET: cfg.ENTITLEMENT_SUBJECT_SECRET || '' };
      if (!localEnv.ENTITLEMENT_SUBJECT_SECRET) {
        localEnv.ENTITLEMENT_SUBJECT_SECRET = (await import('node:util')).parseEnv(env).ENTITLEMENT_SUBJECT_SECRET;
      }
      const gas = new ProviderGasManager(db, localEnv);
      let status = await gas.status(provider);
      if (!status.configured || status.status !== 'active') {
        const draft = await gas.prepare(provider, { owner: owner.address, avalancheBudget: '1', registryBudget: '1',
          avalancheTxLimit: '0.1', registryTxLimit: '0.1', expires: Date.now() + 90 * 86400000 });
        await gas.authorize(provider, await owner.signMessage({ message: draft.message }));
        status = await gas.status(provider);
      }
      if (await client.publicClient.getBalance({ address: status.address }) < parseEther('0.1')) {
        await wait(await faucet.sendTransaction({ to: status.address, value: parseEther('0.5') }));
      }
      // Fund only known development accounts with local faucet tokens.
      for (const address of [owner.address, operator.address]) {
        if (await client.publicClient.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [address] }) < 100_000_000n) {
          await wait(await wallet.writeContract({ address: token, abi: tokenAbi, functionName: 'mint', args: [address, 1_000_000_000n] }));
        }
      }
      const { PostgresBillingStore } = await import('../services/daemon/dist/billing-store.js');
      const billing = new PostgresBillingStore(db);
      const plans = await billing.listPlans();
      for (const [name, amount, credits, interval] of [['Receipt Starter', '1', '5', 'once'], ['Receipt Pro', '10', '100', 'month'], ['Receipt Team', '25', '300', 'month']]) {
        if (!plans.some(p => p.provider_id === provider && p.name === name)) {
          await billing.createPlan({ provider_id: provider, name, amount, credits, interval, feature: 'ocr', merchant_wallet: owner.address });
        }
      }
      configureProviderGrantSigners(id => gas.account(id, 'registry'));
      const grants = new AvalancheGrantStore(db, localEnv);
      for (const [feature, remaining] of [['ocr', '10'], ['research_fetch', '5'], ['api_access', '20']]) {
        if (!(await grants.findLive({ holder: provider, feature })).length) {
          await grants.mint({ merchant: provider, holder: provider, feature, remaining, ttl_seconds: 30 * 86400,
            worker_id: worker.id, renewal_enabled: false, settlement_network: 'avalanche' });
        }
      }
      console.log('Prepared selected local workspace: provider-funded gas, three plans and three on-chain entitlements. No recurring customer permission was synthesized.');
    }
    console.log(`Local token: ${token}\nFunded mandate: ${mandate.id}\nMCP worker: ${worker.id}`);
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
