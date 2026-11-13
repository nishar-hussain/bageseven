import { Subscriptions } from './subscriptions.js';
import { registerRegistryDeployment } from './registry-deployment.js';
import { configureFeatureDatabase } from './feature-registry.js';
import { PostgresSubscriptionStore } from './subscription-store.js';
import { AvalancheSubscriptionChain } from './subscription-chain.js';
import { registerSubscriptionRoutes, cancellationDraft } from './subscription-routes.js';
import { getBillingStore } from './billing-store.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { spendIntentDomain, spendIntentTypes, canonicalSpawn, chainConfigForId, MandateClient, workerKey } from '@bagseven/onchain';
import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { ApiError, createService, type ServiceDeps } from '@bagseven/server';
import { recoverEip191 } from '@bagseven/onchain';
import type { FastifyInstance } from 'fastify';
import { parseUnits } from 'viem';
import { FETCH_FEATURE_ID, featureForAction, getGrantStore } from '@bagseven/entitlements';
import { gte } from '@bagseven/money';
import { decodeX402PaymentRequired, selectX402Requirements, validateX402AgainstPolicy } from './x402.js';
import { X402Authorities } from './x402-authorities.js';
import { X402Payments, type X402Funding } from './x402-payments.js';
import { registerX402Routes } from './x402-routes.js';
import { beginWorkerRequest } from './worker-request-ledger.js';
import { registerWorkerManagement } from './worker-management.js';
import { registerGrantRoutes, type GrantRouteDeps } from './grants.js';
import { AVALANCHE_FUJI_CHAIN_ID, avalancheConfig, ProviderGasManager, providerGasEnabled } from '@bagseven/onchain';
import { configureProviderGrantSigners } from '@bagseven/entitlements';
import { registerProviderGasRoutes } from './provider-gas.js';
import { isPublicEntitlementPath, registerPublicEntitlementRoutes } from './public-entitlements.js';
import { registerBillingRoutes } from './billing.js';

function fromAtomicUnits(units: string): string {
  const value = BigInt(units);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

const fetchSchema = z.object({
  worker: z.string().min(1),
  url: z.string().url().optional(),
  amount: z.string().min(1).optional(),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  reason: z.string().max(500).optional(),
  idempotency_key: z.string().min(1).max(200).optional(),
}).superRefine((value, ctx) => {
  if (!value.url && (!value.amount || !value.recipient)) {
    ctx.addIssue({ code: 'custom', message: 'provide url or both amount and recipient', path: ['url'] });
  }
  if (value.amount && !value.recipient) ctx.addIssue({ code: 'custom', message: 'recipient is required with amount', path: ['recipient'] });
  if (value.recipient && !value.amount) ctx.addIssue({ code: 'custom', message: 'amount is required with recipient', path: ['amount'] });
});

const paymentChallengeSchema = z.object({
  amount: z.string().min(1),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  chain: z.union([z.string(), z.number()]).optional(),
  token: z.string().optional(),
  nonce: z.string().optional(),
  provider: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  expires_at: z.number().int().positive(),
});

const spawnSchema = z.object({
  mandate_id: z.string().uuid(),
  parent_agent_id: z.string().uuid(),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  share_percent: z.number().int().min(1).max(100),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional(),
});

interface WorkerRecord {
  id: string;
  operator_address: string;
  status: string;
}

interface ResolvedWorker {
  agent: WorkerRecord;
  mandate: { id: string; provider_id?: string; owner_address: string; operator_address: string; contract_address: string; status: string; per_purchase_cap: string };
  remaining: { vault_available: string; remaining_window: string; remaining_lifetime: string; can_draw: string };
}

interface SpendResult {
  decision: 'allow' | 'refused';
  tx_hash?: string;
  reservation_id?: string;
  bound?: string;
  reason?: string;
  remaining_window?: string;
  remaining_lifetime?: string;
}

function accountFromEnv(config: NodeJS.ProcessEnv, expected: string): PrivateKeyAccount {
  for (const key of [config.DAEMON_OPERATOR_KEY, config.OPERATOR_DEV_KEY, config.DAEMON_EXECUTOR_KEY]) {
    if (!key) continue;
    const account = privateKeyToAccount(key as `0x${string}`);
    if (account.address.toLowerCase() === expected.toLowerCase()) return account;
  }
  throw new ApiError(403, 'DAEMON_OPERATOR_MISMATCH', 'No configured signer matches this agent operator');
}

function ownerFromEnv(config: NodeJS.ProcessEnv, expected: string): PrivateKeyAccount {
  for (const key of [config.DAEMON_OWNER_KEY, config.OWNER_DEV_KEY, config.AVALANCHE_PRIVATE_KEY]) {
    if (!key) continue;
    const account = privateKeyToAccount(key as `0x${string}`);
    if (account.address.toLowerCase() === expected.toLowerCase()) return account;
  }
  throw new ApiError(403, 'OWNER_SIGNATURE_REQUIRED', 'Provide an owner signature; no configured owner signer matches this mandate');
}

async function daemonApi(config: NodeJS.ProcessEnv, method: string, path: string, body?: unknown): Promise<unknown> {
  const base = config.POLICY_URL ?? 'http://localhost:4003';
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(config.POLICY_INTERNAL_TOKEN ? { authorization: `Bearer ${config.POLICY_INTERNAL_TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(response.status, error?.code ?? 'POLICY_REQUEST_FAILED', error?.message ?? response.statusText, error?.details);
  }
  return payload;
}

async function resolveWorker(config: NodeJS.ProcessEnv, worker: string): Promise<ResolvedWorker> {
  return daemonApi(config, 'GET', `/v1/resolve?ref=${encodeURIComponent(worker)}`) as Promise<ResolvedWorker>;
}

function validateProviderUrl(config: NodeJS.ProcessEnv, rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new ApiError(400, 'PROVIDER_URL_UNSUPPORTED', 'provider URL must use HTTP or HTTPS');
  const allowlist = (config.BAGSEVEN_ALLOWED_PROVIDER_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (config.BAGSEVEN_REQUIRE_PROVIDER_ALLOWLIST === 'true' && !allowlist.includes(url.hostname)) {
    throw new ApiError(403, 'PROVIDER_NOT_ALLOWED', 'provider host is not registered with Bagseven');
  }
  if (allowlist.length > 0 && !allowlist.includes(url.hostname)) throw new ApiError(403, 'PROVIDER_NOT_ALLOWED', 'provider host is not registered with Bagseven');
  return url;
}

function providerRegistry(config: NodeJS.ProcessEnv): Record<string, string> {
  try { return JSON.parse(config.BAGSEVEN_PROVIDER_KEYS ?? '{}') as Record<string, string>; }
  catch { throw new ApiError(503, 'PROVIDER_REGISTRY_INVALID', 'BAGSEVEN_PROVIDER_KEYS must be valid JSON'); }
}

async function registeredProviderAddress(config: NodeJS.ProcessEnv, hostname: string): Promise<string> {
  const configured = providerRegistry(config)[hostname];
  if (configured) return configured.toLowerCase();
  const registered = await daemonApi(config, 'GET', `/v1/providers/${encodeURIComponent(hostname)}`).catch(() => undefined) as { address?: string } | undefined;
  if (!registered?.address) throw new ApiError(403, 'PROVIDER_NOT_REGISTERED', 'provider is not registered with Bagseven');
  return registered.address.toLowerCase();
}

async function verifyChallenge(config: NodeJS.ProcessEnv, url: URL, challenge: z.infer<typeof paymentChallengeSchema>): Promise<void> {
  if (challenge.provider !== url.hostname) throw new ApiError(502, 'PAYMENT_PROVIDER_MISMATCH', 'payment challenge provider does not match the requested host');
  const recipient = challenge.payTo ?? challenge.recipient;
  if (!recipient) throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'payment challenge has no recipient');
  if (challenge.expires_at < Math.floor(Date.now() / 1000)) throw new ApiError(502, 'PAYMENT_CHALLENGE_EXPIRED', 'provider payment challenge has expired');
  const expectedChain = Number(config.CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID);
  if (challenge.chain !== undefined && Number(challenge.chain) !== expectedChain) throw new ApiError(502, 'PAYMENT_CHAIN_MISMATCH', 'provider challenge chain does not match Bagseven');
  const token = avalancheConfig(config).usdt.toLowerCase();
  if (token && challenge.token && challenge.token.toLowerCase() !== token) throw new ApiError(502, 'PAYMENT_TOKEN_MISMATCH', 'provider challenge token does not match Bagseven');
  const providerAddress = await registeredProviderAddress(config, url.hostname);
  const canonical = ['bagseven-payment-v1', url.hostname, challenge.amount, recipient.toLowerCase(), challenge.chain ?? expectedChain, challenge.token?.toLowerCase() ?? token ?? '', challenge.nonce ?? '', challenge.expires_at].join('|');
  const signer = await recoverEip191(canonical, challenge.signature as `0x${string}`).catch(() => '');
  if (signer.toLowerCase() !== providerAddress) throw new ApiError(502, 'PAYMENT_CHALLENGE_SIGNATURE_INVALID', 'provider payment challenge signature is invalid');
}

async function executeSpend(config: NodeJS.ProcessEnv, resolved: ResolvedWorker, amount: string, recipient: string, reason?: string, executionRecipient = recipient, providerGas?: ProviderGasManager, hooks?: Parameters<X402Funding>[1]): Promise<SpendResult> {
  const signer = accountFromEnv(config, resolved.agent.operator_address);
  if (signer.address.toLowerCase() !== resolved.agent.operator_address.toLowerCase()) {
    throw new ApiError(403, 'DAEMON_OPERATOR_MISMATCH', 'daemon signer is not the worker operator');
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = Number(`${now}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`);
  const chainId = Number(config.CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID);
  const signature = await signer.signTypedData({
    domain: spendIntentDomain(chainId),
    types: spendIntentTypes,
    primaryType: 'SpendIntent',
    message: { agentId: resolved.agent.id, amount, recipient: recipient as `0x${string}`, nonce: BigInt(nonce), timestamp: BigInt(now), chainId: BigInt(chainId) },
  });
  const result = await daemonApi(config, 'POST', '/v1/spend-intents', {
    agent_id: resolved.agent.id,
    amount,
    recipient,
    nonce,
    timestamp: now,
    chain_id: chainId,
    signature,
    reason,
    request_id: randomUUID(),
  }) as SpendResult & { authorization?: { contract_address: string; worker_id: `0x${string}`; amount: string; recipient: `0x${string}` } };
  if (result.decision !== 'allow' || !result.reservation_id || !result.authorization) return result;
  await hooks?.reserved(result.reservation_id);
  const executorKey = providerGasEnabled(config)
    ? await providerGas!.account(resolved.mandate.provider_id ?? '', 'avalanche', { journal: hooks?.journal })
    : config.DAEMON_EXECUTOR_KEY as `0x${string}`;
  const executor = new MandateClient(executorKey, { rpcUrl: config.RPC_URL ?? 'http://localhost:8545', chainId });
  try {
    if (!providerGasEnabled(config) && executor.address.toLowerCase() !== (config.DAEMON_EXECUTOR_ADDRESS ?? executor.address).toLowerCase()) throw new ApiError(403, 'DAEMON_EXECUTOR_MISMATCH', 'daemon executor does not match the configured contract enforcer');
    const txHash = await executor.execute(result.authorization.contract_address as `0x${string}`, parseUnits(amount, 6), executionRecipient as `0x${string}`, result.authorization.worker_id);
    if (!hooks) await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/settle`, { tx_hash: txHash, recipient });
    return { ...result, tx_hash: txHash };
  } catch (error) {
    if (!hooks) await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/release`, {}).catch(() => undefined);
    throw new ApiError(502, 'PAYMENT_EXECUTION_FAILED', (error as Error).message);
  }
}

export function buildRoutes(app: FastifyInstance, { config, redis, db }: ServiceDeps): void {
  configureFeatureDatabase(db);
  registerRegistryDeployment(app, db, config);
  const providerGas = new ProviderGasManager(db, config);
  const subscriptions = new Subscriptions(new PostgresSubscriptionStore(db), new AvalancheSubscriptionChain(providerGas, config), getGrantStore(config));
  registerSubscriptionRoutes(app, subscriptions);
  const x402 = new X402Payments(new X402Authorities(db, config), getGrantStore(config), async (job, hooks) => {
    const resolved = await resolveWorker(config, job.data.authority.worker_id);
    if (resolved.mandate.id !== job.data.authority.mandate_id || resolved.mandate.provider_id !== job.data.authority.provider ||
      resolved.agent.status !== 'active' || resolved.mandate.status !== 'active') throw Error('X402_MANDATE_BINDING_REQUIRED');
    return executeSpend(config, resolved, fromAtomicUnits(job.data.amount), job.data.authority.payer,
      'Isolated x402 funding', job.data.authority.payer, providerGas, hooks);
  }, {
    settle: async (id, hash, recipient) => { await daemonApi(config, 'POST', `/v1/reservations/${id}/settle`, { tx_hash: hash, recipient }); },
    release: async id => { await daemonApi(config, 'POST', `/v1/reservations/${id}/release`, {}); },
  });
  registerX402Routes(app, x402, config);

  let ticking = false;
  let planCursor = '';
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      // Resume plan deployment from its committed signed transaction after restarts.
      const pendingPlans = await subscriptions.store.pendingPlans(planCursor, 100);
      planCursor = pendingPlans.at(-1)?.id ?? '';
      for (const saved of pendingPlans) {
        const plan = await getBillingStore(db).getPlan(saved.id);
        if (plan?.interval === 'month') await subscriptions.prepare(plan).catch(error => app.log.warn({ plan: plan.id, error: String(error) }, 'subscription plan pending'));
      }
      await Promise.all([subscriptions.tick(), x402.tick()]);
    } catch (error) { app.log.error({ error: String(error) }, 'subscription worker failed'); }
    finally { ticking = false; }
  };
  app.addHook('onReady', async () => { void tick(); });
  const renewalTimer = setInterval(() => void tick(), 15000);
  renewalTimer.unref();
  app.addHook('onClose', async () => { clearInterval(renewalTimer); });
  configureProviderGrantSigners(provider => providerGas.account(provider, 'registry'));
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.url === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) return;
    if (isPublicEntitlementPath(req.url)) return;
    const token = config.DAEMON_AUTH_TOKEN?.trim();
    if (!token) {
      return reply.code(503).send({ error: { code: 'MISCONFIGURED', message: 'DAEMON_AUTH_TOKEN is required' } });
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'daemon authentication required' } });
    }
  });
  app.post('/internal/workers/:worker/status', async (req) => {
    const { worker } = req.params as { worker: string };
    return resolveWorker(config, worker);
  });

  app.post('/internal/workers/:worker/fetch', async (req) => {
    const { worker } = req.params as { worker: string };
    const body = fetchSchema.parse({ ...(req.body as object), worker });
    if (body.url && body.idempotency_key) {
      const prior = await x402.store.forRequest(worker, body.idempotency_key, body.url);
      if (prior) { await x402.process(prior); return x402.view(prior); }
    }
    const operation = await beginWorkerRequest(redis, worker, body);
    if (operation.replay) {
      const prior = operation.result as { x402_job_id?: string } | undefined;
      if (prior?.x402_job_id) return x402.view(prior.x402_job_id);
      return operation.result;
    }
    const perform = async () => {
    const resolved = await resolveWorker(config, worker);
    if (resolved.agent.status !== 'active' || resolved.mandate.status !== 'active') {
      throw new ApiError(403, 'WORKER_INACTIVE', 'worker or mandate is not active');
    }

    // Dual gate: mandate spend + living entitlement for fetch feature (research_fetch).
    const requireGrant = (config.BAGSEVEN_REQUIRE_GRANT ?? 'true').toLowerCase() !== 'false';
    const grantFeature =
      featureForAction('fetch', config.BAGSEVEN_FETCH_FEATURE) ?? FETCH_FEATURE_ID;
    let grantConsume: { grant_id: string; idempotency_key: string } | undefined;
    if (requireGrant) {
      const store = getGrantStore(config);
      const live = await store.findLive({ worker_id: worker, feature: grantFeature });
      const fallback = live.length === 0
        ? await store.findLive({ feature: grantFeature, holder: resolved.mandate.owner_address })
        : live;
      const grant = fallback[0];
      if (!grant) {
        throw new ApiError(
          403,
          'DUAL_GATE',
          `GRANT_EXPIRED: no living ${grantFeature} entitlement — create one for research fetch first`,
        );
      }
      if (!gte(grant.remaining, '1')) {
        throw new ApiError(403, 'DUAL_GATE', 'GRANT_EMPTY: entitlement credits insufficient for fetch');
      }
      grantConsume = { grant_id: grant.id, idempotency_key: randomUUID() };
    }

    let amount = body.amount;
    let recipient = body.recipient;
    let provider: { status: number; body: unknown } | undefined;
    let challenge: z.infer<typeof paymentChallengeSchema> | undefined;

    if (body.url) {
      const providerUrl = validateProviderUrl(config, body.url);
      let initial: Response;
      try {
        initial = await fetch(providerUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      } catch (error) {
        throw new ApiError(502, 'PROVIDER_FETCH_FAILED', `provider request failed: ${(error as Error).message}`, { url: providerUrl.toString() });
      }
      if (initial.status !== 402) {
        return { decision: 'NO_PAYMENT_REQUIRED', executed: false, provider: { status: initial.status, body: (await initial.text()).slice(0, 10000) } };
      }
      const challengeHeader = initial.headers.get('payment-required');
      const challengeBody = await initial.text();
      let parsed: unknown;
      if (challengeHeader) {
        let decoded = challengeHeader;
        try { decoded = Buffer.from(challengeHeader, 'base64').toString('utf8'); } catch { /* use the raw JSON header */ }
        try { parsed = JSON.parse(decoded); } catch { throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'provider returned an unreadable payment challenge'); }
      } else {
        try { parsed = JSON.parse(challengeBody); } catch { throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'provider returned an unreadable payment challenge'); }
      }
      if (parsed && typeof parsed === 'object' && (parsed as { x402Version?: unknown }).x402Version === 2) {
        const required = decodeX402PaymentRequired(challengeHeader, parsed);
        const configuredChainId = Number(config.CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID);
        const requirement = selectX402Requirements(required, avalancheConfig(config).usdt as `0x${string}`, chainConfigForId(configuredChainId).network);
        validateX402AgainstPolicy(requirement, {
          perPurchaseCap: parseUnits(resolved.mandate.per_purchase_cap, 6),
          remainingWindow: parseUnits(resolved.remaining.remaining_window, 6),
          remainingLifetime: parseUnits(resolved.remaining.remaining_lifetime, 6),
          vaultAvailable: parseUnits(resolved.remaining.vault_available, 6),
        });
        if (!providerGasEnabled(config)) throw new ApiError(409, 'X402_PROVIDER_GAS_REQUIRED', 'Authorize provider-funded gas and a separate isolated payer first');
        if (!body.idempotency_key) throw new ApiError(400, 'X402_IDEMPOTENCY_KEY_REQUIRED', 'Supply a stable idempotency_key for this payment');
        const id = await x402.prepare(resolved.mandate.provider_id ?? '', resolved.agent.id, providerUrl.toString(),
          requirement, body.idempotency_key, grantConsume?.grant_id);
        // The PostgreSQL job is authoritative even if this request or Redis is lost.
        const pending = await x402.view(id);
        await operation.complete(pending);
        await x402.process(id);
        return x402.view(id);
      }
      challenge = paymentChallengeSchema.parse(parsed);
      amount = challenge.amount;
      recipient = challenge.payTo ?? challenge.recipient;
      if (!recipient) throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'payment challenge has no recipient');
      await verifyChallenge(config, providerUrl, challenge);
      const challengeKey = `bagseven:payment-challenge:${providerUrl.hostname}:${challenge.nonce ?? challenge.signature}`;
      const expiresAt = challenge.expires_at;
      const fresh = await redis.set(challengeKey, '1', 'EX', Math.max(1, expiresAt - Math.floor(Date.now() / 1000)), 'NX');
      if (fresh !== 'OK') throw new ApiError(409, 'PAYMENT_CHALLENGE_REPLAYED', 'provider payment challenge has already been used');
    }

    if (!amount || !recipient) throw new ApiError(400, 'PAYMENT_INPUT_REQUIRED', 'amount and recipient are required');
    await operation.checkpoint();
    const result = await executeSpend(config, resolved, amount, recipient, body.reason, recipient, providerGas);
    if (body.url && result.decision === 'allow') {
      const providerUrl = validateProviderUrl(config, body.url);
        const payment = JSON.stringify({ tx_hash: result.tx_hash, amount, recipient, chain_id: Number(config.CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID), nonce: challenge?.nonce ?? null });
        const retry = await fetch(providerUrl, { headers: { 'x-payment': payment, 'x-payment-response': payment }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        provider = { status: retry.status, body: (await retry.text()).slice(0, 10000) };
    }
    let entitlement: unknown = null;
    if (grantConsume && result.decision === 'allow') {
      const store = getGrantStore(config);
      const grant = await store.consume(grantConsume.grant_id, '1', grantConsume.idempotency_key);
      const settleNote = result.tx_hash ? { payment_tx: result.tx_hash, settlement_network: 'avalanche' } : null;
      entitlement = { grant, settlement: settleNote, dual_gate: { mandate: 'ok', grant: 'ok' } };
    }

    return { ...result, worker: resolved.agent, mandate: resolved.mandate, provider, entitlement };
    };
    try { const result = await perform(); await operation.complete(result); return result; }
    catch (error) { await operation.fail(); throw error; }
  });

  app.post('/internal/workers/:worker/spawn', async (req) => {
    const body = spawnSchema.parse(req.body);
    const { worker } = req.params as { worker: string };
    const [bound, resolved] = await Promise.all([resolveWorker(config, worker), resolveWorker(config, body.parent_agent_id)]);
    if (resolved.mandate.id !== bound.mandate.id || body.mandate_id !== bound.mandate.id) throw new ApiError(403, 'MANDATE_SCOPE', 'Child agents must stay inside the bound mandate');
    const tree = await daemonApi(config, 'GET', `/v1/mandates/${bound.mandate.id}`) as { agents: Array<{ id: string; parentAgentId?: string | null }> };
    const allowed = new Set([worker]);
    let changed = true;
    while (changed) { changed = false; for (const agent of tree.agents) if (agent.parentAgentId && allowed.has(agent.parentAgentId) && !allowed.has(agent.id)) { allowed.add(agent.id); changed = true; } }
    if (!allowed.has(body.parent_agent_id)) throw new ApiError(403, 'AGENT_SCOPE', 'Parent must be the bound worker or its descendant');
    const canonical = canonicalSpawn({
      mandateId: body.mandate_id,
      parentAgentId: body.parent_agent_id,
      operator: body.operator_address.toLowerCase() as `0x${string}`,
      sharePercent: body.share_percent,
      chainId: Number(config.CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID),
    });
    const signature = body.signature ?? await ownerFromEnv(config, resolved.mandate.owner_address).signMessage({ message: canonical });
    return daemonApi(config, 'POST', `/v1/mandates/${body.mandate_id}/spawn-agent`, { ...body, chain_id: Number(config.CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID), signature });
  });

  // Public entitlement layer (Registry physics + email and wallet mint gate). Lives beside mandate spend.
  const grantDeps: GrantRouteDeps = {
    claimPayment: async (hash: string) => {
      const chain = avalancheConfig(config).chainId;
      return await redis.set(`avalanche:payment:${chain}:${hash.toLowerCase()}`, 'entitlement', 'NX') === 'OK';
    },
    resolveMandateCapacity: async (workerId: string, amount = '1') => {
      try {
        const resolved = await resolveWorker(config, workerId);
        const client = MandateClient.readOnly({ rpcUrl: avalancheConfig(config).rpcUrl, chainId: avalancheConfig(config).chainId });
        const code = await client.checkWorker(resolved.mandate.contract_address as `0x${string}`, parseUnits(amount, 6), '0x0000000000000000000000000000000000000000', workerKey(resolved.agent.id));
        const ok = code === 0 && resolved.agent.status === 'active' && resolved.mandate.status === 'active'
          && gte(resolved.remaining.remaining_window, amount)
          && gte(resolved.remaining.remaining_lifetime, amount)
          && gte(resolved.remaining.vault_available, amount)
          && gte(resolved.remaining.can_draw, amount)
          && gte(resolved.mandate.per_purchase_cap, amount);
        return {
          ok,
          reason: ok
            ? undefined
            : `onchain_code=${code} window=${resolved.remaining.remaining_window} lifetime=${resolved.remaining.remaining_lifetime} vault=${resolved.remaining.vault_available}`,
          remaining_window: resolved.remaining.remaining_window,
          remaining_lifetime: resolved.remaining.remaining_lifetime,
          vault_available: resolved.remaining.vault_available,
          mandate_id: resolved.mandate.id,
        };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : 'mandate resolve failed',
        };
      }
    },
  };
  grantDeps.subscriptionCancellation = async grantId => {
    const sub = (await subscriptions.store.list()).find(s => s.grantId === grantId && !['CANCELLED', 'ENDED'].includes(s.status));
    if (!sub) return null;
    const updated = await subscriptions.store.lock(sub.id, async () => subscriptions.syncCancellation((await subscriptions.store.get(sub.id))!));
    if (!updated) throw new ApiError(409, 'SUBSCRIPTION_BUSY', 'Subscription is being updated; retry');
    return updated.status === 'CANCELLED' ? null : { ...cancellationDraft(updated), management_url: `${config.CONSOLE_URL || 'http://localhost:3000'}/checkout?session=${encodeURIComponent(updated.checkoutId)}` };
  };
  registerWorkerManagement(app, { config, resolve: worker => resolveWorker(config, worker), policy: (method, path, body) => daemonApi(config, method, path, body) });
  registerProviderGasRoutes(app, db, config);
  registerGrantRoutes(app, grantDeps);
  registerPublicEntitlementRoutes(app, grantDeps);
  registerBillingRoutes(app, { redis, db, subscriptions, validateWorker: async worker => {
    const resolved = await resolveWorker(config, worker);
    if (resolved.agent.status !== 'active' || resolved.mandate.status !== 'active') throw new ApiError(403, 'WORKER_INACTIVE', 'Choose an active agent for this checkout');
  } });
}

function validateEnvContract(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.REDIS_URL) missing.push('REDIS_URL');
  const prod = (process.env.NODE_ENV ?? 'development') === 'production';
  if (prod && !process.env.DAEMON_AUTH_TOKEN) missing.push('DAEMON_AUTH_TOKEN');
  if (prod && !process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (prod && !process.env.AUTH_SECRET) missing.push('AUTH_SECRET');
  if (prod && missing.length) {
    console.error(`[bagseven-daemon] refusing to start — missing env: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (missing.length) {
    console.warn(`[bagseven-daemon] env soft-missing (dev defaults apply): ${missing.join(', ')}`);
  }
  const store = process.env.ENTITLEMENT_STORE ?? 'memory';
  const registryLive = Boolean(process.env.AVALANCHE_ENTITLEMENT_REGISTRY);
  const avalancheDemo = process.env.AVALANCHE_DEMO_SETTLE ?? (prod ? 'false' : 'true');
  console.log(
    `[bagseven-daemon] auth=email_wallet avalanche_demo=${avalancheDemo} registry=${registryLive ? 'live' : store}`,
  );
}

async function main(): Promise<void> {
  validateEnvContract();

  const db = createDb({ connectionString: process.env.DATABASE_URL ?? 'postgres://bagseven:bagseven@localhost:5432/bagseven' });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await createService({
    name: 'bagseven-daemon',
    port: Number(process.env.PORT ?? process.env.DAEMON_PORT ?? 4001),
    db,
    redis,
    buildRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
