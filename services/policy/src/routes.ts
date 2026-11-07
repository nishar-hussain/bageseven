import { readMandateAvailability, readMandateSnapshot, type ChainState } from './mandate-state.js';
import { toUnits, fromUnits } from './usdt-units.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agents, mandates, providers, refusals, reservations, transactions, vaults } from '@bagseven/db';
import { validateMoney, sub, min, max } from '@bagseven/money';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@bagseven/server';
import { canonicalMandate, canonicalSpawn, canonicalWithdraw, MandateClient, ProviderGasManager, providerGasEnabled, verifyProviderScope, whitechainConfig, recoverEip191, recoverSpendIntentSigner, workerKey } from '@bagseven/onchain';
import { encodeFunctionData, parseAbi, recoverMessageAddress, type Address } from 'viem';

const BOUNDS: Record<number, string> = {
  1: 'MandateInactive',
  2: 'PerTxCapExceeded',
  3: 'DailyCapExceeded',
  4: 'LifetimeCapExceeded',
  5: 'PerSellerCapExceeded',
  6: 'DepthExceeded',
  7: 'VaultInsufficient',
  8: 'WorkerInactive',
  9: 'WorkerAllocationExceeded',
};

const createMandateSchema = z.object({
  owner_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  budget_per_window: z.string().min(1),
  window_seconds: z.number().int().positive(),
  lifetime_cap: z.string().min(1),
  per_purchase_cap: z.string().min(1),
  per_seller_pct: z.number().int().min(0).max(10000),
  max_depth: z.number().int().min(0),
  chain_id: z.number().int().default(1874),
  signature: z.string().min(1),
});

const spawnSchema = z.object({
  parent_agent_id: z.string().uuid(),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  share_percent: z.number().int().min(1).max(100),
  chain_id: z.number().int().default(1874),
  signature: z.string().min(1),
});

const spendIntentSchema = z.object({
  agent_id: z.string().uuid(),
  amount: z.string().min(1),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  chain_id: z.number().int().default(1874),
  signature: z.string().min(1),
  reason: z.string().max(500).optional(),
  request_id: z.string().uuid().optional(),
});

const fundSchema = z.object({ amount: z.string().min(1) });
const settlementSchema = z.object({ tx_hash: z.string().min(1), recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

const withdrawSchema = z.object({
  amount: z.string().min(1),
  to_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain_id: z.number().int().default(1874),
  signature: z.string().min(1),
});

const refusalsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  scope: z.enum(['all', 'standing', 'released']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const agentMetaSchema = z.object({
  name: z.string().max(255).optional(),
  mcp_endpoint: z.string().url().optional(),
});

const providerSchema = z.object({
  hostname: z.string().min(1).regex(/^[a-z0-9.-]+$/),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

function mandateClient(config: NodeJS.ProcessEnv): MandateClient {
  // Keep the policy and daemon configuration names compatible. The daemon's
  // production-facing name is DAEMON_EXECUTOR_KEY; ENFORCER_DEV_KEY remains
  // accepted for existing local environments.
  const key = config.DAEMON_EXECUTOR_KEY ?? config.ENFORCER_DEV_KEY;
  if (!key) throw new ApiError(503, 'ENFORCER_UNCONFIGURED', 'DAEMON_EXECUTOR_KEY (or legacy ENFORCER_DEV_KEY) not set');
  return new MandateClient(key as `0x${string}`, {
    rpcUrl: config.RPC_URL ?? 'http://localhost:8545',
    rpcFallbackUrl: config.RPC_FALLBACK_URL,
    chainId: Number(config.CHAIN_ID ?? 1874),
  });
}

/** Deployment pays gas; it must not change the executor enforced by the vault. */
function deploymentClient(config: NodeJS.ProcessEnv): MandateClient {
  if (!config.MANDATE_DEPLOYER_KEY?.trim()) return mandateClient(config);
  return new MandateClient(config.MANDATE_DEPLOYER_KEY.trim() as `0x${string}`, {
    rpcUrl: config.RPC_URL ?? 'http://localhost:8545',
    rpcFallbackUrl: config.RPC_FALLBACK_URL,
    chainId: Number(config.CHAIN_ID ?? 1874),
  });
}

/** Owner-key client, used for owner-only on-chain actions (withdraw/revoke). */
function ownerClient(config: NodeJS.ProcessEnv): MandateClient {
  const key = config.DAEMON_OWNER_KEY ?? config.OWNER_DEV_KEY;
  if (!key) throw new ApiError(503, 'OWNER_KEY_UNCONFIGURED', 'DAEMON_OWNER_KEY (or legacy OWNER_DEV_KEY) not set');
  return new MandateClient(key as `0x${string}`, {
    rpcUrl: config.RPC_URL ?? 'http://localhost:8545',
    rpcFallbackUrl: config.RPC_FALLBACK_URL,
    chainId: Number(config.CHAIN_ID ?? 1874),
  });
}

export function buildPolicyRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
  const gas = new ProviderGasManager(db, config);
  async function paidClient(provider?: string | null) {
    if (!providerGasEnabled(config)) return mandateClient(config);
    if (!provider) throw new ApiError(409, 'PROVIDER_GAS_REQUIRED', 'This legacy permission has no provider gas account. Configure provider gas and create a provider-bound permission.');
    try { return new MandateClient(await gas.account(provider, 'whitechain'), { rpcUrl: config.RPC_URL ?? whitechainConfig(config).rpcUrl, rpcFallbackUrl: config.RPC_FALLBACK_URL, chainId: Number(config.CHAIN_ID ?? 1874) }); }
    catch (error) { throw new ApiError(409, 'PROVIDER_GAS_REQUIRED', (error as Error).message); }
  }
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  app.post('/v1/providers', async (req) => {
    if (!config.PROVIDER_ADMIN_TOKEN || req.headers.authorization !== `Bearer ${config.PROVIDER_ADMIN_TOKEN}`) {
      throw new ApiError(401, 'UNAUTHORIZED', 'provider registration requires administrator authorization');
    }
    const body = providerSchema.parse(req.body);
    const [provider] = await db.insert(providers).values({ hostname: body.hostname.toLowerCase(), address: body.address.toLowerCase(), status: 'active' }).onConflictDoUpdate({ target: providers.hostname, set: { address: body.address.toLowerCase(), status: 'active' } }).returning();
    return provider;
  });

  app.get('/v1/providers/:hostname', async (req) => {
    const { hostname } = req.params as { hostname: string };
    const provider = await db.query.providers.findFirst({ where: eq(providers.hostname, hostname.toLowerCase()) });
    if (!provider || provider.status !== 'active') throw new ApiError(404, 'PROVIDER_NOT_REGISTERED', 'provider is not registered');
    return { hostname: provider.hostname, address: provider.address };
  });

  const getMandate = async (id: string) => {
    let mandate;
    try {
      mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, id) });
    } catch {
      // Keep database connectivity/schema failures distinct from a missing
      // mandate. The dashboard can then show the real recovery action instead
      // of exposing Drizzle's raw SQL as a generic 500.
      throw new ApiError(
        503,
        'DATABASE_QUERY_FAILED',
        'database is unavailable or its migrations are out of date; start PostgreSQL and run pnpm db:migrate',
      );
    }
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'mandate not found');
    return mandate;
  };

  app.get('/v1/mandate-config', async () => {
    const rail = whitechainConfig(config);
    return { chain_id: rail.chainId, token: rail.usdt, rpc_url: rail.chainId === 1874 ? 'https://rpc.testnet.whitechain.io' : 'https://rpc.whitechain.io',
      operator_address: mandateClient(config).address, deployer_address: deploymentClient(config).address };
  });

  app.post('/v1/mandates/prepare', async req => {
    const body = createMandateSchema.omit({ signature: true }).parse(req.body);
    if (body.chain_id !== Number(config.CHAIN_ID ?? 1874)) throw new ApiError(400, 'CHAIN_MISMATCH', 'Select the configured Whitechain network');
    for (const amount of [body.budget_per_window, body.lifetime_cap, body.per_purchase_cap]) {
      validateMoney(amount);
      if (toUnits(amount) <= 0n) throw new ApiError(400, 'INVALID_AMOUNT', 'Spending limits must be positive');
    }
    return { payload: body, message: canonicalMandate({ owner: body.owner_address.toLowerCase() as Address,
      operator: body.operator_address.toLowerCase() as Address, budgetPerWindow: body.budget_per_window,
      windowSeconds: body.window_seconds, lifetimeCap: body.lifetime_cap, perPurchaseCap: body.per_purchase_cap,
      perSellerPct: body.per_seller_pct, maxDepth: body.max_depth, chainId: body.chain_id }) };
  });

  app.post('/v1/mandates/:id/delegation', async req => {
    const { id } = req.params as { id: string };
    await getMandate(id);
    const body = spawnSchema.omit({ signature: true }).parse(req.body);
    if (body.chain_id !== Number(config.CHAIN_ID ?? 1874)) throw new ApiError(400, 'CHAIN_MISMATCH', 'Select the configured Whitechain network');
    return { payload: body, message: canonicalSpawn({ mandateId: id, parentAgentId: body.parent_agent_id,
      operator: body.operator_address.toLowerCase() as Address, sharePercent: body.share_percent, chainId: body.chain_id }) };
  });

  // Drafts only: the owner's wallet sends these transactions and pays gas.
  app.post('/v1/mandates/:id/transaction', async req => {
    const { id } = req.params as { id: string };
    const body = z.object({ action: z.enum(['fund', 'withdraw', 'revoke']), amount: z.string().optional() }).parse(req.body);
    const mandate = await getMandate(id);
    const snapshot = await readMandateSnapshot(mandateClient(config), mandate.contractAddress as Address | null);
    if (snapshot.chain.status === 'unavailable') throw new ApiError(409, 'MANDATE_UNAVAILABLE', snapshot.chain.message);
    const contract = mandate.contractAddress as Address;
    let to = contract;
    let data: `0x${string}`;
    if (body.action === 'revoke') {
      data = encodeFunctionData({ abi: parseAbi(['function revoke()']), functionName: 'revoke' });
    } else {
      const amount = toUnits(body.amount ?? '0');
      if (amount <= 0n) throw new ApiError(400, 'INVALID_AMOUNT', 'Amount must be greater than zero');
      if (body.action === 'fund') {
        if (snapshot.revoked) throw new ApiError(409, 'MANDATE_INACTIVE', 'Do not fund a revoked spending permission');
        if (snapshot.token?.toLowerCase() !== whitechainConfig(config).usdt.toLowerCase()) throw new ApiError(409, 'MANDATE_TOKEN_MISMATCH', 'This vault uses another token');
        to = snapshot.token!;
        data = encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns(bool)']), functionName: 'transfer', args: [contract, amount] });
      } else {
        if (amount > snapshot.vault) throw new ApiError(409, 'VAULT_INSUFFICIENT', 'Withdrawal exceeds the available balance');
        data = encodeFunctionData({ abi: parseAbi(['function withdraw(uint256,address)']), functionName: 'withdraw', args: [amount, mandate.ownerAddress as Address] });
      }
    }
    return { chain_id: Number(config.CHAIN_ID ?? 1874), from: mandate.ownerAddress, to, data, value: '0x0' };
  });

  // Create + sign a mandate: owner wallet signs the canonical payload (EIP-191),
  // the backend verifies the signer is the owner, then deploys the BagMandate
  // contract on-chain — the caps become the immutable, enforced guarantee.
  app.post('/v1/mandates', async (req) => {
    const body = createMandateSchema.parse(req.body);
    if (body.chain_id !== Number(config.CHAIN_ID ?? 1874)) throw new ApiError(400, 'CHAIN_MISMATCH', 'Signed chain_id must match the configured Whitechain network');
    validateMoney(body.budget_per_window);
    validateMoney(body.lifetime_cap);
    validateMoney(body.per_purchase_cap);

    const canonical = canonicalMandate({
      owner: body.owner_address.toLowerCase() as Address,
      operator: body.operator_address.toLowerCase() as Address,
      budgetPerWindow: body.budget_per_window,
      windowSeconds: body.window_seconds,
      lifetimeCap: body.lifetime_cap,
      perPurchaseCap: body.per_purchase_cap,
      perSellerPct: body.per_seller_pct,
      maxDepth: body.max_depth,
      chainId: body.chain_id,
    });
    const signer = await recoverEip191(canonical, body.signature as `0x${string}`).catch(() => '');
    if (signer.toLowerCase() !== body.owner_address.toLowerCase()) {
      throw new ApiError(403, 'SIGNATURE_MISMATCH', 'mandate signature was not produced by the owner address');
    }

    const rootAgentId = randomUUID();
    const executor = mandateClient(config);
    const provider = typeof req.headers['x-bagseven-provider'] === 'string' ? req.headers['x-bagseven-provider'] : undefined;
    if (providerGasEnabled(config) && (!provider || !config.POLICY_INTERNAL_TOKEN || req.headers.authorization !== `Bearer ${config.POLICY_INTERNAL_TOKEN}`)) throw new ApiError(403, 'PROVIDER_SCOPE_REQUIRED', 'Provider-funded deployment requires the authenticated console provider scope');
    if (providerGasEnabled(config) && !verifyProviderScope(req.headers['x-bagseven-provider-scope'], provider!, config)) throw new ApiError(403, 'PROVIDER_SCOPE_REQUIRED', 'A signed provider session scope is required');
    const client = providerGasEnabled(config) ? await paidClient(provider) : deploymentClient(config);
    let contractAddress: Address;
    try { contractAddress = await client.deploy({
      owner: body.owner_address.toLowerCase() as Address,
      operator: body.operator_address.toLowerCase() as Address,
      enforcer: (providerGasEnabled(config) ? client.address : config.DAEMON_EXECUTOR_ADDRESS ?? executor.address) as Address,
      usdc: whitechainConfig(config).usdt as Address,
      budgetPerWindow: toUnits(body.budget_per_window),
      windowSeconds: body.window_seconds,
      lifetimeCap: toUnits(body.lifetime_cap),
      perPurchaseCap: toUnits(body.per_purchase_cap),
      perSellerPct: body.per_seller_pct,
      maxDepth: body.max_depth,
      rootWorker: workerKey(rootAgentId),
      rootAllocation: toUnits(body.lifetime_cap),
    }); } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('provider_gas_')) throw new ApiError(409, 'PROVIDER_GAS_DENIED', (error as Error).message);
      if (/insufficient funds|exceeds the balance|insufficient balance/.test(message)) {
        throw new ApiError(503, 'DEPLOYER_GAS_INSUFFICIENT', providerGasEnabled(config) ? `The provider gas account ${client.address} needs more WBT on Whitechain. Platform funding fallback is disabled; USDT cannot pay gas.` : `The deployment wallet ${client.address} needs more WBT for network gas. Fund the deployment wallet or configure MANDATE_DEPLOYER_KEY with a funded account. USDT is not used for deployment gas.`);
      }
      throw new ApiError(502, 'MANDATE_DEPLOYMENT_FAILED', 'Whitechain could not confirm the permission deployment. Check the deployment wallet activity before retrying to avoid creating a duplicate permission.');
    }

    const mandateId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(mandates).values({
        id: mandateId,
        providerId: providerGasEnabled(config) ? provider : null,
        ownerAddress: body.owner_address.toLowerCase(),
        operatorAddress: body.operator_address.toLowerCase(),
        contractAddress: contractAddress.toLowerCase(),
        budgetPerWindow: body.budget_per_window,
        windowSeconds: body.window_seconds,
        lifetimeCap: body.lifetime_cap,
        perPurchaseCap: body.per_purchase_cap,
        perSellerPct: body.per_seller_pct,
        maxDepth: body.max_depth,
        signature: body.signature,
        status: 'active',
      });
      await tx.insert(vaults).values({ mandateId, contractAddress });
      const [root] = await tx.insert(agents).values({ mandateId, operatorAddress: body.operator_address.toLowerCase(), sharePercent: '100.00', allocation: body.lifetime_cap, depth: 0, status: 'active', id: rootAgentId }).returning();
      if (!root) throw new ApiError(500, 'ROOT_AGENT_FAILED', 'root agent insert returned no row');
    });

    return { mandate_id: mandateId, root_agent_id: rootAgentId, contract_address: contractAddress, status: 'active' };
  });

  // Discover mandates for the console. Owner scope is the production-safe
  // default; all-mandate discovery is deliberately limited to DEV_MODE for
  // local testing and recovery.
  app.get('/v1/mandates', async (req) => {
    const query = z.object({
      owner_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      scope: z.enum(['owner', 'all']).default('owner'),
    }).parse(req.query);
    // Cross-tenant listing is never safe on a shared policy API — even in DEV_MODE.
    if (query.scope === 'all') {
      throw new ApiError(403, 'ALL_MANDATES_DISABLED', 'Use scope=owner with owner_address; all-mandate discovery is disabled');
    }
    if (query.scope === 'owner' && !query.owner_address) {
      throw new ApiError(400, 'OWNER_REQUIRED', 'owner_address is required for owner-scoped mandate discovery');
    }
    const rows = await db.query.mandates.findMany({
      where: eq(mandates.ownerAddress, query.owner_address!.toLowerCase()),
      orderBy: desc(mandates.createdAt),
    });
    return {
      mandates: await Promise.all(rows.map(async (mandate) => {
        const state = await readMandateAvailability(mandateClient(config), mandate.contractAddress as Address | null);
        return {
          id: mandate.id,
          owner_address: mandate.ownerAddress,
          operator_address: mandate.operatorAddress,
          contract_address: mandate.contractAddress,
          budget_per_window: mandate.budgetPerWindow,
          window_seconds: mandate.windowSeconds,
          lifetime_cap: mandate.lifetimeCap,
          per_purchase_cap: mandate.perPurchaseCap,
          per_seller_pct: mandate.perSellerPct,
          max_depth: mandate.maxDepth,
          status: state.chain.status === 'unavailable' ? 'unavailable' : state.revoked ? 'revoked' : mandate.status,
          record_status: mandate.status,
          onchain_state: state.chain,
          created_at: mandate.createdAt,
        };
      })),
    };
  });

  app.get('/v1/mandates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandate(id);
    const client = mandateClient(config);
    const state = await readMandateSnapshot(client, mandate.contractAddress as Address | null);
    const tree = await db.query.agents.findMany({ where: eq(agents.mandateId, id) });
    return {
      mandate: {
        id: mandate.id,
        owner_address: mandate.ownerAddress,
        operator_address: mandate.operatorAddress,
        contract_address: mandate.contractAddress,
        budget_per_window: mandate.budgetPerWindow,
        window_seconds: mandate.windowSeconds,
        lifetime_cap: mandate.lifetimeCap,
        per_purchase_cap: mandate.perPurchaseCap,
        per_seller_pct: mandate.perSellerPct,
        max_depth: mandate.maxDepth,
        status: state.chain.status === 'unavailable' ? 'unavailable' : state.revoked ? 'revoked' : mandate.status,
        record_status: mandate.status,
      },
      token_address: state.token,
      onchain_revoked: state.revoked,
      onchain_state: state.chain,
      vault_balance: fromUnits(state.vault),
      agents: tree,
    };
  });

  app.get('/v1/mandates/:id/overview', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandate(id);
    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address | null;
    const snapshot = await readMandateSnapshot(client, contract);
    const { vault, windowSpent, lifetimeSpent, revoked } = snapshot;
    const chainState = snapshot.chain;

    const windowLeft = sub(mandate.budgetPerWindow, fromUnits(windowSpent));
    const lifetimeLeft = sub(mandate.lifetimeCap, fromUnits(lifetimeSpent));
    const canDraw = chainState.status === 'available' && !revoked
      ? max('0', min(fromUnits(vault), min(windowLeft, lifetimeLeft)))
      : '0.00';

    const tree = await db.query.agents.findMany({ where: eq(agents.mandateId, id) });
    const recentRefusals = await db.query.refusals.findMany({
      where: eq(refusals.mandateId, id),
      orderBy: desc(refusals.requestedAt),
      limit: 5,
    });

    return {
      mandate_id: id,
      spent_this_window: fromUnits(windowSpent),
      budget_per_window: mandate.budgetPerWindow,
      spent_total: fromUnits(lifetimeSpent),
      lifetime_cap: mandate.lifetimeCap,
      vault_available: fromUnits(vault),
      can_be_drawn_now: canDraw,
      onchain_state: chainState,
      onchain_revoked: revoked,
      agents: tree.map((a) => ({ id: a.id, operator_address: a.operatorAddress, share_percent: a.sharePercent, allocation: a.allocation, depth: a.depth, status: a.status, parent_agent_id: a.parentAgentId, name: a.name, mcp_endpoint: a.mcpEndpoint })),
      recent_refusals: recentRefusals,
      terms: {
        contract_address: mandate.contractAddress,
        owner_address: mandate.ownerAddress,
        operator_address: mandate.operatorAddress,
        window_seconds: mandate.windowSeconds,
        per_purchase_cap: mandate.perPurchaseCap,
        per_seller_pct: mandate.perSellerPct,
        max_depth: mandate.maxDepth,
        signed: true,
      },
    };
  });

  // Spawn a child agent under the mandate tree. Owner-signed; child can only be
  // narrower than its parent (share ≤ 100) and depth ≤ the mandate's max depth.
  app.post('/v1/mandates/:id/spawn-agent', async (req) => {
    const { id } = req.params as { id: string };
    const body = spawnSchema.parse(req.body);
    if (body.chain_id !== Number(config.CHAIN_ID ?? 1874)) throw new ApiError(400, 'CHAIN_MISMATCH', 'Signed chain_id must match the configured Whitechain network');
    const mandate = await getMandate(id);
    const parent = await db.query.agents.findFirst({ where: eq(agents.id, body.parent_agent_id) });
    if (!parent || parent.mandateId !== id) throw new ApiError(404, 'NOT_FOUND', 'parent agent not in this mandate');

    const canonical = canonicalSpawn({ mandateId: id, parentAgentId: body.parent_agent_id, operator: body.operator_address.toLowerCase() as Address, sharePercent: body.share_percent, chainId: body.chain_id });
    const signer = await recoverEip191(canonical, body.signature as `0x${string}`).catch(() => '');
    if (signer.toLowerCase() !== mandate.ownerAddress.toLowerCase()) throw new ApiError(403, 'SIGNATURE_MISMATCH', 'spawn was not signed by the owner');

    const depth = parent.depth + 1;
    if (depth > mandate.maxDepth) throw new ApiError(400, 'EXCEEDS_MAX_DEPTH', `child depth ${depth} exceeds max depth ${mandate.maxDepth}`);
    if (body.share_percent > 100) throw new ApiError(400, 'CHILD_TOO_WIDE', 'a child mandate can only be narrower than its parent (share ≤ 100%)');

    const availability = await readMandateAvailability(mandateClient(config), mandate.contractAddress as Address | null);
    if (availability.chain.status === 'unavailable') throw new ApiError(409, 'MANDATE_UNAVAILABLE', availability.chain.message);
    if (availability.revoked) throw new ApiError(403, 'MANDATE_INACTIVE', 'This mandate is revoked');
    const allocation = fromUnits(toUnits(parent.allocation) * BigInt(body.share_percent) / 100n);
    const [agent] = await db.insert(agents).values({ mandateId: id, parentAgentId: body.parent_agent_id, operatorAddress: body.operator_address.toLowerCase(), sharePercent: String(body.share_percent), allocation, depth, status: 'active' }).returning();
    if (!agent) throw new ApiError(500, 'SPAWN_FAILED', 'agent insert returned no row');
    try {
      const client = await paidClient(mandate.providerId);
      await client.registerWorker(mandate.contractAddress as Address, workerKey(agent.id), workerKey(parent.id), agent.operatorAddress as Address, toUnits(allocation), depth);
    } catch (error) {
      await db.update(agents).set({ status: 'suspended' }).where(eq(agents.id, agent.id));
      throw new ApiError(502, 'WORKER_CHAIN_REGISTRATION_FAILED', (error as Error).message);
    }
    return { agent_id: agent.id, depth, share_percent: body.share_percent, parent_agent_id: body.parent_agent_id };
  });

  app.post('/v1/reservations/:id/settle', async (req) => {
    if (!config.POLICY_INTERNAL_TOKEN || req.headers.authorization !== `Bearer ${config.POLICY_INTERNAL_TOKEN}`) throw new ApiError(401, 'UNAUTHORIZED', 'internal authorization required');
    const { id } = req.params as { id: string };
    const body = settlementSchema.parse(req.body);
    const reservation = await db.query.reservations.findFirst({ where: eq(reservations.id, id) });
    if (!reservation) throw new ApiError(404, 'NOT_FOUND', 'reservation not found');
    if (reservation.status === 'settled') return { status: 'settled', tx_hash: body.tx_hash };
    const mandate = await getMandate(reservation.mandateId);
    const client = mandateClient(config);
    await db.transaction(async (tx) => {
      await tx.update(reservations).set({ status: 'settled' }).where(eq(reservations.id, id));
      await tx.insert(transactions).values({ mandateId: mandate.id, agentId: reservation.agentId, txHash: body.tx_hash, amount: reservation.amount, type: 'commit' });
      const [w, l, s] = await Promise.all([client.spendState(mandate.contractAddress as Address), client.lifetimeSpent(mandate.contractAddress as Address), client.sellerSpent(mandate.contractAddress as Address, body.recipient as Address)]);
      const sellerSpent = { ...((mandate.sellerSpent as Record<string, string>) ?? {}) };
      sellerSpent[body.recipient.toLowerCase()] = fromUnits(s);
      await tx.update(mandates).set({ windowSpent: fromUnits(w), lifetimeSpent: fromUnits(l), sellerSpent }).where(eq(mandates.id, mandate.id));
    });
    return { status: 'settled', tx_hash: body.tx_hash };
  });

  app.post('/v1/reservations/:id/release', async (req) => {
    if (!config.POLICY_INTERNAL_TOKEN || req.headers.authorization !== `Bearer ${config.POLICY_INTERNAL_TOKEN}`) throw new ApiError(401, 'UNAUTHORIZED', 'internal authorization required');
    const { id } = req.params as { id: string };
    await db.update(reservations).set({ status: 'released' }).where(eq(reservations.id, id));
    return { status: 'released' };
  });

  // The hot path. The OPERATOR key signs an EIP-712 spend intent; the policy
  // service verifies the signer and reserves the request. In daemon-executor
  // mode the daemon submits the transaction, then settles this reservation.
  app.post('/v1/spend-intents', async (req) => {
    const body = spendIntentSchema.parse(req.body);
    if (body.chain_id !== Number(config.CHAIN_ID ?? 1874)) throw new ApiError(400, 'CHAIN_MISMATCH', 'Signed chain_id must match the configured Whitechain network');
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - body.timestamp) > Number(config.SPEND_INTENT_MAX_AGE_SECONDS ?? 300)) {
      throw new ApiError(400, 'SPEND_INTENT_EXPIRED', 'spend intent timestamp is outside the allowed window');
    }
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agent_id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
    const mandate = await getMandate(agent.mandateId);
    if (mandate.status !== 'active') throw new ApiError(403, 'MANDATE_INACTIVE', `mandate is ${mandate.status}`);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'mandate has no deployed contract');

    const intent = { agentId: body.agent_id, amount: body.amount, recipient: body.recipient as Address, nonce: body.nonce, timestamp: body.timestamp, chainId: body.chain_id };
    const signer = await recoverSpendIntentSigner(intent, body.signature as `0x${string}`, body.chain_id).catch(() => '');
    if (signer.toLowerCase() !== agent.operatorAddress.toLowerCase()) throw new ApiError(403, 'OPERATOR_MISMATCH', 'spend intent was not signed by the agent operator');

    const used = await redis.set(`spendnonce:${body.agent_id}:${body.nonce}`, '1', 'EX', 86400, 'NX');
    if (used !== 'OK') throw new ApiError(409, 'NONCE_REUSED', `nonce ${body.nonce} already used`);

    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address;
    const availability = await readMandateAvailability(client, contract);
    if (availability.chain.status === 'unavailable') throw new ApiError(409, 'MANDATE_UNAVAILABLE', availability.chain.message);
    const code = await client.checkWorker(contract, toUnits(body.amount), body.recipient as Address, workerKey(agent.id));
    const refusalId = randomUUID();

    if (code !== 0) {
      const bound = BOUNDS[code] ?? 'Unknown';
      await db.insert(refusals).values({ id: refusalId, mandateId: mandate.id, agentId: agent.id, amount: body.amount, seller: body.recipient, bound, reason: body.reason ?? bound });
      return { decision: 'refused', refusal_id: refusalId, bound, reason: bound };
    }

    const [reservation] = await db
      .insert(reservations)
      .values({ mandateId: mandate.id, agentId: agent.id, amount: body.amount, status: 'reserved', expiresAt: new Date(Date.now() + 60_000) })
      .returning();
    if (!reservation) throw new ApiError(500, 'RESERVE_FAILED', 'reservation insert returned no row');

    if (providerGasEnabled(config) || config.DAEMON_EXECUTOR_ADDRESS) {
      const [w, l] = await Promise.all([client.spendState(contract), client.lifetimeSpent(contract)]);
      return {
        decision: 'allow',
        reservation_id: reservation.id,
        authorization: { contract_address: contract, worker_id: workerKey(agent.id), amount: body.amount, recipient: body.recipient, chain_id: body.chain_id },
        remaining_window: sub(mandate.budgetPerWindow, fromUnits(w + toUnits(body.amount))),
        remaining_lifetime: sub(mandate.lifetimeCap, fromUnits(l + toUnits(body.amount))),
      };
    }

    try {
      const txHash = await client.execute(contract, toUnits(body.amount), body.recipient as Address, workerKey(agent.id));
      await db.transaction(async (tx) => {
        await tx.update(reservations).set({ status: 'settled' }).where(eq(reservations.id, reservation.id));
        await tx.insert(transactions).values({ mandateId: mandate.id, agentId: agent.id, txHash, amount: body.amount, type: 'commit' });
        const [w, l, s] = await Promise.all([client.spendState(contract), client.lifetimeSpent(contract), client.sellerSpent(contract, body.recipient as Address)]);
        const sellerSpent = { ...((mandate.sellerSpent as Record<string, string>) ?? {}) };
        sellerSpent[body.recipient.toLowerCase()] = fromUnits(s);
        await tx.update(mandates).set({ windowSpent: fromUnits(w), lifetimeSpent: fromUnits(l), sellerSpent }).where(eq(mandates.id, mandate.id));
      });
      const [w, l] = await Promise.all([client.spendState(contract), client.lifetimeSpent(contract)]);
      return {
        decision: 'allow',
        reservation_id: reservation.id,
        tx_hash: txHash,
        remaining_window: sub(mandate.budgetPerWindow, fromUnits(w)),
        remaining_lifetime: sub(mandate.lifetimeCap, fromUnits(l)),
      };
    } catch (err) {
      const bound = /(MandateInactive|PerTxCapExceeded|DailyCapExceeded|LifetimeCapExceeded|PerSellerCapExceeded|DepthExceeded|VaultInsufficient)/.exec((err as Error).message)?.[1] ?? 'ExecuteFailed';
      await db.transaction(async (tx) => {
        await tx.update(reservations).set({ status: 'released' }).where(eq(reservations.id, reservation.id));
        await tx.insert(refusals).values({ id: refusalId, mandateId: mandate.id, agentId: agent.id, amount: body.amount, seller: body.recipient, bound, reason: body.reason ?? bound });
      });
      return { decision: 'refused', refusal_id: refusalId, bound, reason: bound };
    }
  });

  // Set an agent's ENS-style name + MCP endpoint (console metadata, owner-facing).
  app.post('/v1/agents/:id/meta', async (req) => {
    const { id } = req.params as { id: string };
    const body = agentMetaSchema.parse(req.body);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
    const [updated] = await db
      .update(agents)
      .set({ name: body.name ?? agent.name, mcpEndpoint: body.mcp_endpoint ?? agent.mcpEndpoint })
      .where(eq(agents.id, id))
      .returning();
    if (!updated) throw new ApiError(500, 'AGENT_META_FAILED', 'agent update returned no row');
    return { agent: { id: updated.id, name: updated.name, mcp_endpoint: updated.mcpEndpoint } };
  });

  app.get('/v1/refusals', async (req) => {
    const query = refusalsQuery.parse(req.query);
    const where = query.agent_id ? eq(refusals.agentId, query.agent_id) : undefined;
    const rows = await db.query.refusals.findMany({ where, orderBy: desc(refusals.requestedAt), limit: query.limit });
    const out = [];
    for (const row of rows) {
      let status: 'standing' | 'released' = 'standing';
      const mandate = await getMandate(row.mandateId).catch(() => null);
      if (mandate?.contractAddress) {
        try {
          const code = await mandateClient(config).check(mandate.contractAddress as Address, toUnits(row.amount), (row.seller ?? '0x0000000000000000000000000000000000000000') as Address, 0);
          if (code === 0) status = 'released';
        } catch {
          /* keep standing */
        }
      }
      out.push({ ...row, status });
    }
    const scoped = query.scope === 'all' ? out : out.filter((r) => r.status === query.scope);
    return { refusals: scoped, scope: query.scope };
  });

  // Resolve an agent by id or operator address → mandate + remaining budget.
  app.get('/v1/resolve', async (req) => {
    const { ref } = z.object({ ref: z.string().min(1) }).parse(req.query);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const agent = isUuid ? await db.query.agents.findFirst({ where: eq(agents.id, ref) }) : await db.query.agents.findFirst({ where: eq(agents.operatorAddress, ref.toLowerCase()) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', `no agent found for ${ref}`);
    const mandate = await getMandate(agent.mandateId);
    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address | null;
    const snapshot = await readMandateSnapshot(client, contract);
    let chainState: ChainState = snapshot.chain;
    let state: Awaited<ReturnType<MandateClient['workerState']>> | null = null;
    if (chainState.status === 'available' && contract) {
      try { state = await client.workerState(contract, workerKey(agent.id)); }
      catch { chainState = { status: 'unavailable', code: 'CONTRACT_UNSUPPORTED', message: 'The agent registration could not be read from this deployment. Spending is disabled.' }; }
    }
    const { vault, windowSpent: w, lifetimeSpent: l, revoked } = snapshot;
    const allocationLeft = state ? fromUnits(state[2] > state[3] ? state[2] - state[3] : 0n) : '0';
    return {
      agent: { id: agent.id, operator_address: agent.operatorAddress, allocation: agent.allocation, remaining_allocation: allocationLeft, onchain_active: state?.[5] ?? false, depth: agent.depth, share_percent: agent.sharePercent, status: agent.status, name: agent.name, mcp_endpoint: agent.mcpEndpoint },
      mandate: { id: mandate.id, provider_id: mandate.providerId, owner_address: mandate.ownerAddress, operator_address: mandate.operatorAddress, contract_address: mandate.contractAddress, status: chainState.status === 'unavailable' ? 'unavailable' : revoked ? 'revoked' : mandate.status, record_status: mandate.status, onchain_state: chainState, onchain_revoked: revoked, budget_per_window: mandate.budgetPerWindow, lifetime_cap: mandate.lifetimeCap, per_purchase_cap: mandate.perPurchaseCap, per_seller_pct: mandate.perSellerPct, max_depth: mandate.maxDepth },
      remaining: {
        vault_available: fromUnits(vault),
        remaining_window: sub(mandate.budgetPerWindow, fromUnits(w)),
        remaining_lifetime: sub(mandate.lifetimeCap, fromUnits(l)),
        can_draw: chainState.status === 'unavailable' || revoked || !state?.[5] ? '0' : max('0', min(allocationLeft, min(mandate.perPurchaseCap, min(fromUnits(vault), min(sub(mandate.budgetPerWindow, fromUnits(w)), sub(mandate.lifetimeCap, fromUnits(l))))))),
      },
    };
  });

  // Vault: fund (dev faucet = the backend enforcer key) / withdraw (owner-signed).
  app.get('/v1/vaults/:mandateId', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const client = mandateClient(config);
    const state = await readMandateSnapshot(client, mandate.contractAddress as Address);
    if (state.chain.status === 'unavailable') throw new ApiError(409, 'MANDATE_UNAVAILABLE', state.chain.message);
    return { vault_balance: fromUnits(state.vault) };
  });

  app.post('/v1/vaults/:mandateId/fund', async (req) => {
    if (providerGasEnabled(config)) throw new ApiError(403, 'WALLET_APPROVAL_REQUIRED', 'Fund the vault from the owner wallet; platform-funded transfers are disabled');
    const { mandateId } = req.params as { mandateId: string };
    const body = fundSchema.parse(req.body);
    validateMoney(body.amount);
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const client = mandateClient(config);
    const availability = await readMandateAvailability(client, mandate.contractAddress as Address);
    if (availability.chain.status === 'unavailable') throw new ApiError(409, 'MANDATE_UNAVAILABLE', availability.chain.message);
    await client.fund(mandate.contractAddress as Address, whitechainConfig(config).usdt as Address, toUnits(body.amount));
    await db.insert(transactions).values({ mandateId, amount: body.amount, type: 'fund' });
    return { vault_balance: fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) };
  });

  app.post('/v1/vaults/:mandateId/withdraw', async (req) => {
    if (providerGasEnabled(config)) throw new ApiError(403, 'WALLET_APPROVAL_REQUIRED', 'Use the owner-wallet withdrawal draft; platform-funded withdrawal gas is disabled');
    const { mandateId } = req.params as { mandateId: string };
    const body = withdrawSchema.parse(req.body);
    if (body.chain_id !== Number(config.CHAIN_ID ?? 1874)) throw new ApiError(400, 'CHAIN_MISMATCH', 'Signed chain_id must match the configured Whitechain network');
    validateMoney(body.amount);
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const canonical = canonicalWithdraw({ mandateId, amount: body.amount, to: body.to_address.toLowerCase() as Address, chainId: body.chain_id });
    const signer = await recoverMessageAddress({ message: canonical, signature: body.signature as `0x${string}` }).catch(() => '');
    if (signer.toLowerCase() !== mandate.ownerAddress.toLowerCase()) throw new ApiError(403, 'SIGNATURE_MISMATCH', 'withdraw was not signed by the owner');
    const availability = await readMandateAvailability(mandateClient(config), mandate.contractAddress as Address);
    if (availability.chain.status === 'unavailable') throw new ApiError(409, 'MANDATE_UNAVAILABLE', availability.chain.message);
    const txHash = await ownerClient(config).withdraw(mandate.contractAddress as Address, toUnits(body.amount), body.to_address.toLowerCase() as Address);
    await db.insert(transactions).values({ mandateId, amount: body.amount, type: 'withdraw' });
    return { tx_hash: txHash, vault_balance: fromUnits(await mandateClient(config).vaultBalance(mandate.contractAddress as Address)) };
  });
}
