import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { spendIntentDomain, spendIntentTypes, canonicalSpawn, chainConfigForId, MandateClient } from '@bagseven/onchain';
import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { ApiError, createService, type ServiceDeps } from '@bagseven/server';
import { recoverEip191 } from '@bagseven/onchain';
import type { FastifyInstance } from 'fastify';
import { parseUnits } from 'viem';
import { FETCH_FEATURE_ID, featureForAction, getGrantStore } from '@bagseven/entitlements';
import { gte } from '@bagseven/money';
import { decodeX402PaymentRequired, selectX402Requirements, validateX402AgainstPolicy, type X402Requirements } from './x402.js';
import { x402PayerFromEnv, type X402Payer } from './x402-payer.js';
import { registerGrantRoutes } from './grants.js';
import { WHITECHAIN_CHAIN_ID } from '@bagseven/onchain';
import { settleWhitechainUsdt } from './whitechain-settle.js';
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
});

interface WorkerRecord {
  id: string;
  operator_address: string;
  status: string;
}

interface ResolvedWorker {
  agent: WorkerRecord;
  mandate: { id: string; owner_address: string; operator_address: string; contract_address: string; status: string; per_purchase_cap: string };
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

function accountFromEnv(config: NodeJS.ProcessEnv): PrivateKeyAccount {
  const key = config.DAEMON_OPERATOR_KEY ?? config.OPERATOR_DEV_KEY;
  if (!key) throw new ApiError(503, 'DAEMON_OPERATOR_UNCONFIGURED', 'DAEMON_OPERATOR_KEY is not configured');
  return privateKeyToAccount(key as `0x${string}`);
}

function ownerFromEnv(config: NodeJS.ProcessEnv): PrivateKeyAccount {
  const key = config.DAEMON_OWNER_KEY ?? config.OWNER_DEV_KEY;
  if (!key) throw new ApiError(503, 'DAEMON_OWNER_UNCONFIGURED', 'DAEMON_OWNER_KEY is not configured');
  return privateKeyToAccount(key as `0x${string}`);
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
  const expectedChain = Number(config.CHAIN_ID ?? WHITECHAIN_CHAIN_ID);
  if (challenge.chain !== undefined && Number(challenge.chain) !== expectedChain) throw new ApiError(502, 'PAYMENT_CHAIN_MISMATCH', 'provider challenge chain does not match Bagseven');
  const token = config.USDC_ADDRESS?.toLowerCase();
  if (token && challenge.token && challenge.token.toLowerCase() !== token) throw new ApiError(502, 'PAYMENT_TOKEN_MISMATCH', 'provider challenge token does not match Bagseven');
  const providerAddress = await registeredProviderAddress(config, url.hostname);
  const canonical = ['bagseven-payment-v1', url.hostname, challenge.amount, recipient.toLowerCase(), challenge.chain ?? expectedChain, challenge.token?.toLowerCase() ?? token ?? '', challenge.nonce ?? '', challenge.expires_at].join('|');
  const signer = await recoverEip191(canonical, challenge.signature as `0x${string}`).catch(() => '');
  if (signer.toLowerCase() !== providerAddress) throw new ApiError(502, 'PAYMENT_CHALLENGE_SIGNATURE_INVALID', 'provider payment challenge signature is invalid');
}

async function executeSpend(config: NodeJS.ProcessEnv, resolved: ResolvedWorker, amount: string, recipient: string, reason?: string, executionRecipient = recipient): Promise<SpendResult> {
  const signer = accountFromEnv(config);
  if (signer.address.toLowerCase() !== resolved.agent.operator_address.toLowerCase()) {
    throw new ApiError(403, 'DAEMON_OPERATOR_MISMATCH', 'daemon signer is not the worker operator');
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = Number(`${now}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`);
  const chainId = Number(config.CHAIN_ID ?? WHITECHAIN_CHAIN_ID);
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
  if (result.decision !== 'allow' || !config.DAEMON_EXECUTOR_KEY || !result.reservation_id || !result.authorization) return result;
  const executor = new MandateClient(config.DAEMON_EXECUTOR_KEY as `0x${string}`, { rpcUrl: config.RPC_URL ?? 'http://localhost:8545', chainId });
  try {
    if (executor.address.toLowerCase() !== (config.DAEMON_EXECUTOR_ADDRESS ?? executor.address).toLowerCase()) throw new ApiError(403, 'DAEMON_EXECUTOR_MISMATCH', 'daemon executor does not match the configured contract enforcer');
    const txHash = await executor.execute(result.authorization.contract_address as `0x${string}`, parseUnits(amount, 6), executionRecipient as `0x${string}`, result.authorization.worker_id);
    await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/settle`, { tx_hash: txHash, recipient });
    return { ...result, tx_hash: txHash };
  } catch (error) {
    await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/release`, {}).catch(() => undefined);
    throw new ApiError(502, 'PAYMENT_EXECUTION_FAILED', (error as Error).message);
  }
}

function buildRoutes(app: FastifyInstance, { config, redis }: ServiceDeps): void {
  app.addHook('preHandler', async (req, reply) => {
    if (isPublicEntitlementPath(req.url)) return;
    const token = config.DAEMON_AUTH_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
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
    const resolved = await resolveWorker(config, worker);
    if (resolved.agent.status !== 'active' || resolved.mandate.status !== 'active') {
      throw new ApiError(403, 'WORKER_INACTIVE', 'worker or mandate is not active');
    }

    // Dual gate: mandate spend + living entitlement for fetch feature (research_fetch).
    const requireGrant = (config.BAGSEVEN_REQUIRE_GRANT ?? 'true').toLowerCase() !== 'false';
    const grantFeature =
      featureForAction('fetch', config.BAGSEVEN_GRANT_FEATURE) ?? FETCH_FEATURE_ID;
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
    let x402Requirement: X402Requirements | undefined;
    let x402Payment: { required: ReturnType<typeof decodeX402PaymentRequired>; payer: X402Payer } | undefined;

    if (body.url) {
      const providerUrl = validateProviderUrl(config, body.url);
      let initial: Response;
      try {
        initial = await fetch(providerUrl);
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
        const configuredChainId = Number(config.CHAIN_ID ?? WHITECHAIN_CHAIN_ID);
        const requirement = selectX402Requirements(required, (config.USDC_ADDRESS ?? '') as `0x${string}`, chainConfigForId(configuredChainId).network);
        validateX402AgainstPolicy(requirement, {
          perPurchaseCap: parseUnits(resolved.mandate.per_purchase_cap, 6),
          remainingWindow: parseUnits(resolved.remaining.remaining_window, 6),
          remainingLifetime: parseUnits(resolved.remaining.remaining_lifetime, 6),
          vaultAvailable: parseUnits(resolved.remaining.vault_available, 6),
        });
        let payer: X402Payer;
        try {
          payer = x402PayerFromEnv(config, resolved.agent.operator_address, config.DAEMON_EXECUTOR_ADDRESS ?? '');
        } catch (error) {
          throw new ApiError(503, 'X402_PAYER_UNCONFIGURED', (error as Error).message);
        }
        let payerBalance: bigint;
        try {
          payerBalance = await payer.balance();
        } catch (error) {
          throw new ApiError(503, 'X402_PAYER_RPC_FAILED', `could not read x402 payer balance: ${(error as Error).message}`);
        }
        if (config.BAGSEVEN_X402_PAYER_ALLOW_NONZERO !== 'true' && payerBalance !== 0n) {
          throw new ApiError(409, 'X402_PAYER_NOT_EMPTY', 'isolated x402 payer has an existing USDC balance; set BAGSEVEN_X402_PAYER_ALLOW_NONZERO=true only for a controlled testnet payer');
        }
        x402Requirement = requirement;
        x402Payment = { required, payer };
        amount = fromAtomicUnits(requirement.amount);
        recipient = requirement.payTo;
      }
      if (!x402Requirement) {
        challenge = paymentChallengeSchema.parse(parsed);
        amount = challenge.amount;
        recipient = challenge.payTo ?? challenge.recipient;
        if (!recipient) throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'payment challenge has no recipient');
        await verifyChallenge(config, providerUrl, challenge);
      }
      const challengeKey = `bagseven:payment-challenge:${providerUrl.hostname}:${x402Requirement ? `${x402Requirement.network}:${x402Requirement.asset}:${x402Requirement.amount}:${x402Requirement.payTo}` : (challenge?.nonce ?? challenge?.signature)}`;
      const expiresAt = x402Requirement
        ? Math.floor(Date.now() / 1000) + x402Requirement.maxTimeoutSeconds
        : challenge?.expires_at ?? Math.floor(Date.now() / 1000) + 120;
      const fresh = await redis.set(challengeKey, '1', 'EX', Math.max(1, expiresAt - Math.floor(Date.now() / 1000)), 'NX');
      if (fresh !== 'OK') throw new ApiError(409, 'PAYMENT_CHALLENGE_REPLAYED', 'provider payment challenge has already been used');
    }

    if (!amount || !recipient) throw new ApiError(400, 'PAYMENT_INPUT_REQUIRED', 'amount and recipient are required');
    const payerAddress = x402Payment?.payer.account.address;
    const result = await executeSpend(config, resolved, amount, recipient, body.reason, payerAddress ?? recipient);
    if (body.url && result.decision === 'allow') {
      const providerUrl = validateProviderUrl(config, body.url);
      if (x402Payment && x402Requirement) {
        if (!result.reservation_id || !result.tx_hash) {
          if (result.reservation_id) await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/release`, {}).catch(() => undefined);
          throw new ApiError(503, 'X402_EXECUTOR_UNCONFIGURED', 'x402 payer requires a configured daemon executor and a confirmed BagMandate funding transaction');
        }
        try {
          const payment = await x402Payment.payer.createPayment(x402Payment.required, x402Requirement);
          const retry = await fetch(providerUrl, { headers: { 'PAYMENT-SIGNATURE': payment.header } });
          const responseBody = (await retry.text()).slice(0, 10000);
          if (!retry.ok) {
            await x402Payment.payer.refund(resolved.mandate.contract_address as `0x${string}`, payment.amount);
            await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/release`, {}).catch(() => undefined);
            throw new ApiError(502, 'X402_SETTLEMENT_FAILED', `provider rejected x402 payment (${retry.status})`, { body: responseBody });
          }
          provider = { status: retry.status, body: responseBody };
        } catch (error) {
          if (error instanceof ApiError) throw error;
          await x402Payment.payer.refund(resolved.mandate.contract_address as `0x${string}`, x402Payment.payer.account.address === payerAddress ? parseUnits(amount, 6) : 0n).catch(() => undefined);
          await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/release`, {}).catch(() => undefined);
          throw new ApiError(502, 'X402_SETTLEMENT_FAILED', (error as Error).message);
        }
      } else {
        const payment = JSON.stringify({ tx_hash: result.tx_hash, amount, recipient, chain_id: Number(config.CHAIN_ID ?? WHITECHAIN_CHAIN_ID), nonce: challenge?.nonce ?? null });
        const retry = await fetch(providerUrl, { headers: { 'x-payment': payment, 'x-payment-response': payment } });
        provider = { status: retry.status, body: (await retry.text()).slice(0, 10000) };
      }
    }
    let entitlement: unknown = null;
    if (grantConsume && result.decision === 'allow') {
      const store = getGrantStore(config);
      const grant = await store.consume(grantConsume.grant_id, '1', grantConsume.idempotency_key);
      const settleNote = grant.payment_tx
        ? await settleWhitechainUsdt({
            amount: amount ?? '0',
            feature: grantFeature,
            holder: grant.holder,
            grant_id: grant.id,
            payment_tx: grant.payment_tx,
            reason: 'fetch_audit',
          }).catch(() => null)
        : null;
      entitlement = { grant, settlement: settleNote, dual_gate: { mandate: 'ok', grant: 'ok' } };
    }

    return { ...result, worker: resolved.agent, mandate: resolved.mandate, provider, entitlement };
  });

  app.post('/internal/workers/:worker/spawn', async (req) => {
    const body = spawnSchema.parse(req.body);
    const resolved = await resolveWorker(config, body.parent_agent_id);
    const owner = ownerFromEnv(config);
    if (owner.address.toLowerCase() !== resolved.mandate.owner_address.toLowerCase()) {
      throw new ApiError(403, 'DAEMON_OWNER_MISMATCH', 'daemon owner signer is not authorized for this mandate');
    }
    const canonical = canonicalSpawn({
      mandateId: body.mandate_id,
      parentAgentId: body.parent_agent_id,
      operator: body.operator_address.toLowerCase() as `0x${string}`,
      sharePercent: body.share_percent,
      chainId: Number(config.CHAIN_ID ?? WHITECHAIN_CHAIN_ID),
    });
    const signature = await owner.signMessage({ message: canonical });
    return daemonApi(config, 'POST', `/v1/mandates/${body.mandate_id}/spawn-agent`, { ...body, chain_id: Number(config.CHAIN_ID ?? WHITECHAIN_CHAIN_ID), signature });
  });

  // Public entitlement layer (Arkiv physics + World mint gate). Lives beside mandate spend.
  const grantDeps = {
    resolveMandateCapacity: async (workerId: string, amount = '1') => {
      try {
        const resolved = await resolveWorker(config, workerId);
        const ok = resolved.agent.status === 'active' && resolved.mandate.status === 'active'
          && gte(resolved.remaining.remaining_window, amount)
          && gte(resolved.remaining.remaining_lifetime, amount)
          && gte(resolved.remaining.vault_available, amount)
          && gte(resolved.remaining.can_draw, amount)
          && gte(resolved.mandate.per_purchase_cap, amount);
        return {
          ok,
          reason: ok
            ? undefined
            : `window=${resolved.remaining.remaining_window} lifetime=${resolved.remaining.remaining_lifetime} vault=${resolved.remaining.vault_available}`,
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
  registerGrantRoutes(app, grantDeps);
  registerPublicEntitlementRoutes(app, grantDeps);
  registerBillingRoutes(app);
}

function validateEnvContract(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.REDIS_URL) missing.push('REDIS_URL');
  const prod = (process.env.NODE_ENV ?? 'development') === 'production';
  if (prod && !process.env.DAEMON_AUTH_TOKEN) missing.push('DAEMON_AUTH_TOKEN');
  if (prod && !process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (prod && !process.env.AUTH_SECRET) missing.push('AUTH_SECRET');
  if (prod && (process.env.WORLD_SKIP_JWKS ?? '').toLowerCase() === 'true') {
    console.error('[bagseven-daemon] refusing to start — WORLD_SKIP_JWKS is forbidden in production');
    process.exit(1);
  }
  if (prod && missing.length) {
    console.error(`[bagseven-daemon] refusing to start — missing env: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (missing.length) {
    console.warn(`[bagseven-daemon] env soft-missing (dev defaults apply): ${missing.join(', ')}`);
  }
  const store = process.env.ENTITLEMENT_STORE ?? 'memory';
  const arkivLive = Boolean(process.env.ARKIV_ACCESS_KEY && (process.env.ARKIV_PRIVATE_KEY || process.env.PRIVATE_KEY));
  const whitechainDemo = process.env.WHITECHAIN_DEMO_SETTLE ?? (prod ? 'false' : 'true');
  const idkit = Boolean(process.env.WORLD_RP_ID?.trim() && process.env.WORLD_RP_SIGNING_KEY?.trim());
  const worldMode = idkit ? 'idkit' : process.env.WORLD_CLIENT_ID ? 'oidc' : 'mock';
  console.log(
    `[bagseven-daemon] tracks world=${worldMode} mock_proofs=${process.env.WORLD_MOCK_PROOFS ?? 'true'} whitechain_demo=${whitechainDemo} arkiv=${arkivLive ? 'live' : store}`,
  );
}

async function main(): Promise<void> {
  validateEnvContract();

  const db = createDb({ connectionString: process.env.DATABASE_URL ?? 'postgres://bagseven:bagseven@localhost:5432/bagseven' });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await createService({
    name: 'bagseven-daemon',
    port: Number(process.env.DAEMON_PORT ?? 4001),
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
