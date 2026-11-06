import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agents, mandates, providers, refusals, reservations, transactions, vaults } from '@bagseven/db';
import { validateMoney, sub } from '@bagseven/money';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@bagseven/server';
import { canonicalMandate, canonicalSpawn, canonicalWithdraw, MandateClient, recoverEip191, recoverSpendIntentSigner, workerKey } from '@bagseven/onchain';
import { recoverMessageAddress, type Address } from 'viem';

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

function toUnits(amount: string): bigint {
  const [int = '0', frac = ''] = amount.split('.');
  return BigInt(int) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
}
function fromUnits(units: bigint): string {
  const n = Number(units) / 1e6;
  return n.toFixed(2);
}

const createMandateSchema = z.object({
  owner_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  budget_per_window: z.string().min(1),
  window_seconds: z.number().int().positive(),
  lifetime_cap: z.string().min(1),
  per_purchase_cap: z.string().min(1),
  per_seller_pct: z.number().int().min(0).max(10000),
  max_depth: z.number().int().min(0),
  chain_id: z.number().int().default(43113),
  signature: z.string().min(1),
});

const spawnSchema = z.object({
  parent_agent_id: z.string().uuid(),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  share_percent: z.number().int().min(1).max(100),
  chain_id: z.number().int().default(43113),
  signature: z.string().min(1),
});

const spendIntentSchema = z.object({
  agent_id: z.string().uuid(),
  amount: z.string().min(1),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  chain_id: z.number().int().default(43113),
  signature: z.string().min(1),
  reason: z.string().max(500).optional(),
  request_id: z.string().uuid().optional(),
});

const fundSchema = z.object({ amount: z.string().min(1) });
const settlementSchema = z.object({ tx_hash: z.string().min(1), recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

const withdrawSchema = z.object({
  amount: z.string().min(1),
  to_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain_id: z.number().int().default(43113),
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
    chainId: Number(config.CHAIN_ID ?? 43113),
  });
}

/** Owner-key client, used for owner-only on-chain actions (withdraw/revoke). */
function ownerClient(config: NodeJS.ProcessEnv): MandateClient {
  const key = config.DAEMON_OWNER_KEY ?? config.OWNER_DEV_KEY;
  if (!key) throw new ApiError(503, 'OWNER_KEY_UNCONFIGURED', 'DAEMON_OWNER_KEY (or legacy OWNER_DEV_KEY) not set');
  return new MandateClient(key as `0x${string}`, {
    rpcUrl: config.RPC_URL ?? 'http://localhost:8545',
    rpcFallbackUrl: config.RPC_FALLBACK_URL,
    chainId: Number(config.CHAIN_ID ?? 43113),
  });
}

export function buildPolicyRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
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

  // Create + sign a mandate: owner wallet signs the canonical payload (EIP-191),
  // the backend verifies the signer is the owner, then deploys the BagMandate
  // contract on-chain — the caps become the immutable, enforced guarantee.
  app.post('/v1/mandates', async (req) => {
    const body = createMandateSchema.parse(req.body);
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
    const client = mandateClient(config);
    const contractAddress = await client.deploy({
      owner: body.owner_address.toLowerCase() as Address,
      operator: body.operator_address.toLowerCase() as Address,
      enforcer: (config.DAEMON_EXECUTOR_ADDRESS ?? client.address) as Address,
      usdc: (config.USDC_ADDRESS ?? '0x') as Address,
      budgetPerWindow: toUnits(body.budget_per_window),
      windowSeconds: body.window_seconds,
      lifetimeCap: toUnits(body.lifetime_cap),
      perPurchaseCap: toUnits(body.per_purchase_cap),
      perSellerPct: body.per_seller_pct,
      maxDepth: body.max_depth,
      rootWorker: workerKey(rootAgentId),
      rootAllocation: toUnits(body.lifetime_cap),
    });

    const mandateId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(mandates).values({
        id: mandateId,
        ownerAddress: body.owner_address.toLowerCase(),
        operatorAddress: body.operator_address.toLowerCase(),
        contractAddress,
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
    if (query.scope === 'all' && config.DEV_MODE !== 'true') {
      throw new ApiError(403, 'ALL_MANDATES_DISABLED', 'all-mandate discovery is only available in development mode');
    }
    if (query.scope === 'owner' && !query.owner_address) {
      throw new ApiError(400, 'OWNER_REQUIRED', 'owner_address is required for owner-scoped mandate discovery');
    }
    const rows = await db.query.mandates.findMany({
      where: query.scope === 'all' ? undefined : eq(mandates.ownerAddress, query.owner_address!.toLowerCase()),
      orderBy: desc(mandates.createdAt),
    });
    return {
      mandates: rows.map((mandate) => ({
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
        status: mandate.status,
        created_at: mandate.createdAt,
      })),
    };
  });

  app.get('/v1/mandates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandate(id);
    const client = mandateClient(config);
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
        status: mandate.status,
      },
      vault_balance: mandate.contractAddress ? fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) : '0.00',
      agents: tree,
    };
  });

  app.get('/v1/mandates/:id/overview', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandate(id);
    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address | null;
    let vault = 0n;
    let windowSpent = 0n;
    let lifetimeSpent = 0n;
    let chainState: { status: 'available' } | { status: 'unavailable'; message: string } = { status: 'available' };
    if (contract) {
      try {
        [vault, windowSpent, lifetimeSpent] = await Promise.all([
          client.vaultBalance(contract),
          client.spendState(contract),
          client.lifetimeSpent(contract),
        ]);
      } catch (error) {
        // The overview is also the dashboard's recovery surface. An RPC outage,
        // stale contract address, or provider rate limit must not turn the whole
        // console into a 500. Keep the database-backed tree/terms visible, but
        // fail closed for drawability until live chain state is available again.
        chainState = { status: 'unavailable', message: 'live on-chain state is temporarily unavailable' };
      }
    }

    const windowLeft = sub(mandate.budgetPerWindow, fromUnits(windowSpent));
    const lifetimeLeft = sub(mandate.lifetimeCap, fromUnits(lifetimeSpent));
    const canDraw = chainState.status === 'available'
      ? Math.max(0, Math.min(Number(fromUnits(vault)), Number(windowLeft), Number(lifetimeLeft))).toFixed(2)
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
      agents: tree.map((a) => ({ id: a.id, operator_address: a.operatorAddress, share_percent: a.sharePercent, depth: a.depth, status: a.status, parent_agent_id: a.parentAgentId, name: a.name, mcp_endpoint: a.mcpEndpoint })),
      recent_refusals: recentRefusals,
      terms: {
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
    const mandate = await getMandate(id);
    const parent = await db.query.agents.findFirst({ where: eq(agents.id, body.parent_agent_id) });
    if (!parent || parent.mandateId !== id) throw new ApiError(404, 'NOT_FOUND', 'parent agent not in this mandate');

    const canonical = canonicalSpawn({ mandateId: id, parentAgentId: body.parent_agent_id, operator: body.operator_address.toLowerCase() as Address, sharePercent: body.share_percent, chainId: body.chain_id });
    const signer = await recoverEip191(canonical, body.signature as `0x${string}`).catch(() => '');
    if (signer.toLowerCase() !== mandate.ownerAddress.toLowerCase()) throw new ApiError(403, 'SIGNATURE_MISMATCH', 'spawn was not signed by the owner');

    const depth = parent.depth + 1;
    if (depth > mandate.maxDepth) throw new ApiError(400, 'EXCEEDS_MAX_DEPTH', `child depth ${depth} exceeds max depth ${mandate.maxDepth}`);
    if (body.share_percent > 100) throw new ApiError(400, 'CHILD_TOO_WIDE', 'a child mandate can only be narrower than its parent (share ≤ 100%)');

    const allocation = fromUnits(toUnits(parent.allocation) * BigInt(body.share_percent) / 100n);
    const [agent] = await db.insert(agents).values({ mandateId: id, parentAgentId: body.parent_agent_id, operatorAddress: body.operator_address.toLowerCase(), sharePercent: String(body.share_percent), allocation, depth, status: 'active' }).returning();
    if (!agent) throw new ApiError(500, 'SPAWN_FAILED', 'agent insert returned no row');
    try {
      const client = mandateClient(config);
      await client.registerWorker(mandate.contractAddress as Address, workerKey(agent.id), workerKey(parent.id), agent.operatorAddress as Address, toUnits(allocation), depth);
    } catch (error) {
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

    if (config.DAEMON_EXECUTOR_ADDRESS) {
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
    const [vault, w, l] = contract ? await Promise.all([client.vaultBalance(contract), client.spendState(contract), client.lifetimeSpent(contract)]) : [0n, 0n, 0n];
    return {
      agent: { id: agent.id, operator_address: agent.operatorAddress, depth: agent.depth, share_percent: agent.sharePercent, status: agent.status, name: agent.name, mcp_endpoint: agent.mcpEndpoint },
      mandate: { id: mandate.id, owner_address: mandate.ownerAddress, operator_address: mandate.operatorAddress, contract_address: mandate.contractAddress, status: mandate.status, budget_per_window: mandate.budgetPerWindow, lifetime_cap: mandate.lifetimeCap, per_purchase_cap: mandate.perPurchaseCap, per_seller_pct: mandate.perSellerPct, max_depth: mandate.maxDepth },
      remaining: {
        vault_available: fromUnits(vault),
        remaining_window: sub(mandate.budgetPerWindow, fromUnits(w)),
        remaining_lifetime: sub(mandate.lifetimeCap, fromUnits(l)),
        can_draw: Math.min(Number(fromUnits(vault)), Number(sub(mandate.budgetPerWindow, fromUnits(w))), Number(sub(mandate.lifetimeCap, fromUnits(l)))).toFixed(2),
      },
    };
  });

  // Vault: fund (dev faucet = the backend enforcer key) / withdraw (owner-signed).
  app.get('/v1/vaults/:mandateId', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const client = mandateClient(config);
    return { vault_balance: fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) };
  });

  app.post('/v1/vaults/:mandateId/fund', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const body = fundSchema.parse(req.body);
    validateMoney(body.amount);
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const client = mandateClient(config);
    await client.fund(mandate.contractAddress as Address, (config.USDC_ADDRESS ?? '0x') as Address, toUnits(body.amount));
    await db.insert(transactions).values({ mandateId, amount: body.amount, type: 'fund' });
    return { vault_balance: fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) };
  });

  app.post('/v1/vaults/:mandateId/withdraw', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const body = withdrawSchema.parse(req.body);
    validateMoney(body.amount);
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const canonical = canonicalWithdraw({ mandateId, amount: body.amount, to: body.to_address.toLowerCase() as Address, chainId: body.chain_id });
    const signer = await recoverMessageAddress({ message: canonical, signature: body.signature as `0x${string}` }).catch(() => '');
    if (signer.toLowerCase() !== mandate.ownerAddress.toLowerCase()) throw new ApiError(403, 'SIGNATURE_MISMATCH', 'withdraw was not signed by the owner');
    const txHash = await ownerClient(config).withdraw(mandate.contractAddress as Address, toUnits(body.amount), body.to_address.toLowerCase() as Address);
    await db.insert(transactions).values({ mandateId, amount: body.amount, type: 'withdraw' });
    return { tx_hash: txHash, vault_balance: fromUnits(await mandateClient(config).vaultBalance(mandate.contractAddress as Address)) };
  });
}
