#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { createDb, agents, mandates, vaults } from '@bagseven/db';
import { MandateClient, canonicalMandate, workerKey } from '@bagseven/onchain';
import { createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

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
  const wallet = createWalletClient({ account: executor, chain: avalancheFuji, transport: http(cfg.RPC_URL) });
  const tokenAbi = parseAbi(['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)']);
  const wait = async (hash) => {
    const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('Local chain transaction reverted');
    return receipt;
  };
  // Generated development keys need not be Anvil's prefunded accounts.
  const faucet = createWalletClient({ account: owner, chain: avalancheFuji, transport: http(cfg.RPC_URL) });
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
    for (const [key, value] of Object.entries({ USDC_ADDRESS: token, LOCAL_MANDATE_ID: mandate.id, BAGSEVEN_MCP_WORKER: worker.id })) {
      const re = new RegExp(`^${key}=.*$`, 'm');
      env = re.test(env) ? env.replace(re, () => `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
    }
    writeFileSync(envPath, env);
    console.log(`Local token: ${token}\nFunded mandate: ${mandate.id}\nMCP worker: ${worker.id}`);
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
