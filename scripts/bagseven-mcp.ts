/**
 * Bagseven MCP — the agent-facing protocol adapter.
 *
 * MCP deliberately contains no wallet or policy logic. It forwards requests
 * to the Bagseven daemon, which identifies the worker, signs the request and
 * calls the policy/mandate services.
 */
import { registerManagementTools } from './mcp-management-tools.ts';
import { scopedDaemon, type McpPrincipal } from './mcp-principal.ts';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && process.env[line.slice(0, i)] === undefined) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch {
  /* .env is optional in deployed environments. */
}

const DAEMON = process.env.DAEMON_URL ?? 'http://localhost:4001';
const WORKER = process.env.BAGSEVEN_MCP_WORKER;

async function daemon(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<unknown> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (process.env.DAEMON_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.DAEMON_AUTH_TOKEN}`;
  let response: Response;
  try {
    response = await fetch(`${DAEMON}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Bagseven daemon is unreachable at ${DAEMON}; start the daemon on port 4001 (${(error as Error).message})`, { cause: error });
  }
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : undefined;
  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } } | undefined)?.error;
    const details = error?.details === undefined ? '' : ` details=${JSON.stringify(error.details)}`;
    throw new Error(`${error?.code ? `${error.code}: ` : ''}${error?.message ?? `Bagseven daemon request failed (${response.status})`}${details}`);
  }
  return payload;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function buildServer(worker = WORKER, callDaemon = daemon, principal?: McpPrincipal): McpServer {
  if (!worker) throw new Error('BAGSEVEN_MCP_WORKER must bind this MCP instance to one worker');
  if (principal) callDaemon = scopedDaemon(principal, callDaemon);
  const accountHolder = principal && principal.clientId !== 'static' ? principal.humanId : undefined;
  const server = new McpServer({ name: 'bagseven-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  registerManagementTools(server, worker, callDaemon);
  async function optionalCheckoutWorker() {
    try {
      const bound = await callDaemon('POST', `/internal/workers/${encodeURIComponent(worker!)}/status`) as { mandate: { owner_address: string } };
      return { worker_id: worker!, owner: bound.mandate.owner_address };
    } catch (error) {
      if (/NOT_FOUND|no agent found|WORKER_OWNER_MISMATCH/i.test((error as Error).message)) return undefined;
      throw error;
    }
  }

  server.registerTool(
    'bagseven_status',
    {
      title: 'Bagseven worker status',
      description:
        'Read worker mandate capacity when the UUID is a registered policy agent; otherwise return dual-gate track status + living grants (entitlements-only mode).',
      inputSchema: {},
    },
    async () => {
      try {
        return text(await callDaemon('POST', `/internal/workers/${encodeURIComponent(worker)}/status`));
      } catch (error) {
        const message = (error as Error).message;
        if (!/NOT_FOUND|no agent found|WORKER_OWNER_MISMATCH/i.test(message)) throw error;
        const tracks = await callDaemon('GET', '/internal/mumbai/status');
        // All living entitlements — do not force OCR filter
        const grants = await callDaemon('GET', '/internal/grants/live');
        return text({
          mode: 'entitlements_only',
          worker: worker,
          note:
            'This BAGSEVEN_MCP_worker is not registered as a policy agent. Grant reads and minting still work. Prepaid paid_run remains available. Register a spending permission/agent for new payments through bagseven_fetch.',
          tracks,
          grants,
        });
      }
    },
  );

  server.registerTool(
    'bagseven_fetch',
    {
      title: 'Bagseven controlled payment',
      description: 'Request a direct payment or fetch a paid HTTP resource. The Bagseven daemon handles the payment challenge, policy evaluation and mandate settlement.',
      inputSchema: {
        url: z.string().url().optional().describe('paid HTTP resource; the daemon will handle a 402 payment challenge'),
        amount: z.string().min(1).optional().describe('direct USDT amount; must fit the live mandate budget'),
        recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe('direct recipient wallet address'),
        reason: z.string().max(500).optional().describe('audit reason'),
        idempotency_key: z.string().min(1).max(200).optional().describe('Use the same key when retrying a payment to prevent duplicate transfers'),
      },
    },
    async ({ url, amount, recipient, reason, idempotency_key }) => {
      const cleanUrl = url?.trim() || undefined;
      // For an x402 URL, the daemon must derive amount and recipient from the
      // provider's signed 402 challenge. Ignore any extra values hallucinated
      // by the model, which may be empty, formatted as currency, or invalid.
      const request = cleanUrl
        ? { url: cleanUrl, reason: reason?.trim() || undefined, idempotency_key }
        : {
            // Models commonly serialize optional fields as empty strings.
            // Remove those values before daemon validation.
            amount: amount?.trim() || undefined,
            recipient: recipient?.trim() || undefined,
            reason: reason?.trim() || undefined, idempotency_key,
          };
      return text(await callDaemon('POST', `/internal/workers/${encodeURIComponent(worker)}/fetch`, request));
    },
  );

  server.registerTool(
    'bagseven_x402_payment',
    {
      title: 'Bagseven payment status',
      description: 'Reconcile an isolated x402 payment using on-chain evidence. Does not create a new payment or grant wallet access.',
      inputSchema: { payment_id: z.string().uuid() },
    },
    async ({ payment_id }) => text(await callDaemon('POST', `/internal/workers/${encodeURIComponent(worker)}/x402/${payment_id}`, {})),
  );

  server.registerTool(
    'bagseven_spawn',
    {
      title: 'Bagseven child worker',
      description: 'Create a child worker under an existing Bagseven mandate.',
      inputSchema: {
        mandate_id: z.string().uuid().optional(),
        parent_agent_id: z.string().uuid().optional(),
        operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        share_percent: z.number().int().min(1).max(100),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional(),
      },
    },
    async ({ mandate_id, parent_agent_id, operator_address, share_percent, signature }) => {
      const current = await callDaemon('POST', `/internal/workers/${encodeURIComponent(worker)}/status`) as { mandate: { id: string } };
      return text(await callDaemon('POST', `/internal/workers/${encodeURIComponent(worker)}/spawn`, { mandate_id: mandate_id ?? current.mandate.id, parent_agent_id: parent_agent_id ?? worker, operator_address, share_percent, signature }));
    },
  );

  // --- Public entitlement tools (access clock). Mandate caps money; grants cap features. ---

  server.registerTool(
    'grant_status',
    {
      title: 'Live entitlement status',
      description:
        'Operator-wide living entitlement catalog. Use list_agent_entitlements for grants assigned to the bound agent. Omit feature to list all SKUs; expired grants are absent.',
      inputSchema: {
        holder: z.string().optional(),
        feature: z.string().optional().describe('Optional feature SKU filter; omit for all'),
      },
    },
    async ({ holder, feature }) => {
      const params = new URLSearchParams();
      if (holder) params.set('holder', holder);
      if (feature?.trim()) params.set('feature', feature.trim());
      const qs = params.toString();
      return text(await callDaemon('GET', `/internal/grants/live${qs ? `?${qs}` : ''}`));
    },
  );

  // Paid access is purchased through a provider checkout; agents never receive account credentials or wallet keys.
  for (const name of ['buy_access', 'buy_credits']) {
    server.registerTool(name, {
      title: name === 'buy_credits' ? 'Buy entitlement credits' : 'Create paid entitlement',
      description: 'Choose a provider plan and open a real wallet checkout. email and wallet consent is handled during OAuth; never paste account tokens or private keys. If no plan is selected, returns matching plans.',
      inputSchema: { plan_id: z.string().optional(), feature: z.string().default('ocr'), holder: z.string().optional() },
    }, async ({ plan_id, feature, holder = accountHolder }) => {
      const plans = await callDaemon('GET', '/v1/plans') as { plans: Array<{ id: string; feature: string; active: boolean }> };
      const matching = plans.plans.filter(plan => plan.active && plan.feature === feature);
      if (!plan_id) return text({ requires_plan: true, plans: matching, next_step: 'Choose plan_id and call this tool again to open wallet checkout.' });
      if (!matching.some(plan => plan.id === plan_id)) throw new Error('Choose an active provider plan for this feature');
      const bound = await optionalCheckoutWorker();
      if (!holder && !bound) return text({ requires_holder: true, next_step: 'Provide the customer holder for wallet checkout. Registering a spending agent is optional.' });
      const result = await callDaemon('POST', '/v1/checkout-sessions', { plan_id, holder: holder ?? `wallet:${bound!.owner.toLowerCase()}`, ...(bound ? { worker_id: bound.worker_id } : {}) }) as { session: { id: string } };
      const base = (process.env.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3000').replace(/\/$/, '');
      return text({ ...result, checkout_url: `${base}/checkout?session=${encodeURIComponent(result.session.id)}`, requires_wallet_payment: true });
    });
  }

  server.registerTool(
    'create_checkout_session',
    {
      title: 'Create checkout session',
      description:
        'Open a plan checkout session for a holder. Buyer pays the configured stablecoin with an EVM wallet on Avalanche; verified payment issues a registry grant.',
      inputSchema: {
        worker_id: z.string().uuid().optional().describe('Target agent; defaults to this MCP worker'),
        plan_id: z.string().min(1),
        holder: z.string().min(1),
        success_url: z.string().url().optional(),
        expires_in: z.number().int().positive().max(86_400).optional(),
      },
    },
    async (input) => {
      const { worker_id: explicitWorker, ...checkoutInput } = input;
      const checkoutWorker = explicitWorker ?? (await optionalCheckoutWorker())?.worker_id;
      const result = await callDaemon('POST', '/v1/checkout-sessions', { ...checkoutInput, ...(checkoutWorker ? { worker_id: checkoutWorker } : {}) }) as { session: { id: string } };
      const consoleUrl = (process.env.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3000').replace(/\/$/, '');
      return text({ ...result, checkout_url: `${consoleUrl}/checkout?session=${encodeURIComponent(result.session.id)}` });
    },
  );

  server.registerTool(
    'check_entitlement',
    {
      title: 'Check entitlement',
      description: 'Schematic-style check: is this feature enabled for a holder, with remaining credits and TTL? Reads living Registry grants.',
      inputSchema: {
        feature: z.string().min(1).default('ocr'),
        holder: z.string().optional().describe('Defaults to scanning living grants bound to this worker'),
      },
    },
    async ({ feature, holder }) => {
      const params = new URLSearchParams({ feature });
      if (holder) params.set('holder', holder);
      const live = (await callDaemon('GET', `/internal/grants/live?${params.toString()}`)) as { grants?: Array<{ remaining: string; worker_id?: string; enabled?: boolean; paid_through?: string; id: string; feature: string }> };
      const ranked = [...(live.grants ?? [])].filter(g => (!g.worker_id || g.worker_id === worker) && g.enabled !== false).sort((a, b) => Number(b.remaining) - Number(a.remaining));
      const grant = ranked[0];
      const enabled = Boolean(grant && Number(grant.remaining) > 0);
      return text({
        feature,
        enabled,
        remaining: grant?.remaining ?? '0',
        paid_through: grant?.paid_through ?? null,
        grant_id: grant?.id ?? null,
        value: enabled,
      });
    },
  );

  server.registerTool(
    'consume_entitlement',
    {
      title: 'Consume entitlement',
      description: 'Consume already-paid credits from a living grant with holder and worker authorization. Does not create a payment or require a spending mandate.',
      inputSchema: {
        feature: z.string().min(1).default('ocr'),
        holder: z.string().optional(),
        amount: z.string().default('1'),
        idempotency_key: z.string().optional(),
        grant_id: z.string().optional(),
      },
    },
    async (input) =>
      text(
        await callDaemon('POST', '/internal/grants/paid-run', {
          feature: input.feature,
          holder: input.holder,
          amount: input.amount,
          idempotency_key: input.idempotency_key ?? `mcp-consume-${Date.now()}`,
          grant_id: input.grant_id,
          worker_id: worker,
        }),
      ),
  );

  server.registerTool(
    'paid_run',
    {
      title: 'Use prepaid service credits',
      description:
        'Use credits from a living entitlement without making a new payment or requiring a spending mandate. Pass feature to target a SKU, or omit to auto-pick the richest living grant. Pass grant_id only when targeting a specific grant.',
      inputSchema: {
        feature: z.string().optional().describe('Feature SKU (ocr | research_fetch); omit to auto-pick any'),
        grant_id: z.string().optional().describe('Optional specific grant UUID; omit to auto-pick'),
        amount: z.string().default('1'),
        work: z.string().max(2000).optional(),
        idempotency_key: z.string().optional(),
      },
    },
    async (input) =>
      text(
        await callDaemon('POST', '/internal/grants/paid-run', {
          feature: input.feature?.trim() || undefined,
          grant_id: input.grant_id?.trim() || undefined,
          amount: input.amount,
          work: input.work,
          idempotency_key: input.idempotency_key,
          worker_id: worker,
        }),
      ),
  );

  server.registerTool(
    'cancel_renewal',
    {
      title: 'Cancel renewal only',
      description: 'Preserves paid access. For recurring subscriptions, returns a cancellation transaction that the payer must approve in their wallet. For legacy grants, turns off the renewal flag.',
      inputSchema: { grant_id: z.string().min(1) },
    },
    async ({ grant_id }) => text(await callDaemon('POST', `/internal/grants/${encodeURIComponent(grant_id)}/cancel-renewal`)),
  );

  server.registerTool(
    'explain_denial',
    {
      title: 'Explain access or payment denial',
      description: 'Explain access refusal. Choose operation=payment to also check the agent spending permission, without sending a payment.',
      inputSchema: {
        grant_id: z.string().optional(),
        feature: z.string().optional(),
        holder: z.string().optional(),
        amount: z.string().default('1'),
        operation: z.enum(['access', 'payment']).default('access'),
        outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
      },
    },
    async (input) => text(await callDaemon('POST', '/internal/grants/explain-denial', {
      ...input,
      worker_id: worker,
    })),
  );

  return server;
}

/** Each HTTP request authenticates independently; no process-local transport session is needed. */
export async function handleStatelessMcp(req: import('express').Request, res: import('express').Response, server: McpServer) {
  if (req.method !== 'POST') {
    await server.close();
    res.setHeader('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    return;
  }
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: undefined });
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (error) { await transport.close(); await server.close(); throw error; }
}

async function main(): Promise<void> {
  if (!WORKER) throw new Error('BAGSEVEN_MCP_WORKER is required');
  const httpPort = process.env.PORT ?? process.env.BAGSEVEN_MCP_PORT ?? process.env.MCP_HTTP_PORT;
  if (httpPort) {
    const express = (await import('express')).default;
    const { mountMcpOAuth, verifyMcpAccessToken, oauthChallenge } = await import('./mcp-oauth-as.ts');
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: false }));
    const { isCorsOriginAllowed } = await import('@bagseven/server');
    const corsEnv = { ...process.env, CORS_ORIGIN: process.env.BAGSEVEN_MCP_CORS_ORIGIN ?? process.env.CORS_ORIGIN };
    const publicUrl = (process.env.BAGSEVEN_MCP_PUBLIC_URL ?? '').replace(/\/$/, '');
    const oauthRequired =
      (process.env.MCP_OAUTH_REQUIRED ?? (publicUrl ? 'true' : 'false')).toLowerCase() === 'true';
    if (process.env.NODE_ENV === 'production' && (!oauthRequired || !publicUrl.startsWith('https://'))) {
      throw Error('MCP_PRODUCTION_AUTH_REQUIRED: configure OAuth and an HTTPS public URL');
    }

    app.use((req, res, next) => {
      res.vary('Origin');
      if (req.headers.origin && isCorsOriginAllowed(req.headers.origin, corsEnv)) {
        res.setHeader('access-control-allow-origin', req.headers.origin);
      }
      res.setHeader(
        'access-control-allow-headers',
        'authorization, content-type, mcp-session-id, accept, mcp-protocol-version',
      );
      res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('access-control-expose-headers', 'mcp-session-id');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    // Lightweight request log so we can see ChatGPT tool traffic.
    app.use((req, _res, next) => {
      if (req.path === '/mcp' || req.path === '/v1/mcp' || req.path.startsWith('/oauth')) {
        const method = typeof req.body?.method === 'string' ? req.body.method : req.method;
        console.error(`[bagseven-mcp] ${req.method} ${req.path} rpc=${method} sid=${req.headers['mcp-session-id'] ?? '-'}`);
      }
      next();
    });

    mountMcpOAuth(app);

    const proxyUrl = process.env.BAGSEVEN_DAEMON_PROXY_URL;
    const health = async (_req: import('express').Request, res: import('express').Response) => {
      if (proxyUrl) {
        try {
          const upstream = await fetch(`${proxyUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
          if (!upstream.ok || !(await upstream.json() as { ok?: boolean }).ok) throw new Error('daemon not ready');
        } catch { res.status(503).json({ ok: false, service: 'bagseven-daemon-mcp', reason: 'daemon not ready' }); return; }
      }
      res.json({
        ok: true,
        service: proxyUrl ? 'bagseven-daemon-mcp' : 'bagseven-mcp',
        worker: WORKER,
        paths: ['/mcp', '/v1/mcp'],
        oauth: oauthRequired,
        public_url: publicUrl || null,
      });
    };

    const requireBearer = (req: import('express').Request, res: import('express').Response, tok: McpPrincipal | null): boolean => {
      if (!(oauthRequired || process.env.MCP_AUTH_TOKEN)) return true;
      const base = publicUrl || `${req.protocol}://${req.headers.host}`;
      if (tok) return true;
      res.setHeader('WWW-Authenticate', oauthChallenge(base));
      res.status(401).json({
        error: 'unauthorized',
        message: oauthRequired
          ? 'Complete ChatGPT OAuth (email and wallet consent on the authorize page) to obtain a Bearer token.'
          : 'Bearer MCP_AUTH_TOKEN required.',
      });
      return false;
    };

    const mcpHandler = async (req: import('express').Request, res: import('express').Response) => {
      try {
        const principal = await verifyMcpAccessToken(req.headers.authorization);
        if (!requireBearer(req, res, principal)) return;
        await handleStatelessMcp(req, res, buildServer(WORKER, daemon, principal ?? undefined));
      } catch (error) {
        console.error('[bagseven-mcp] request failed', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
            id: null,
          });
        }
      }
    };

    // Health must NOT be on /mcp — ChatGPT uses GET /mcp for the SSE stream.
    app.get('/health', health);
    app.get('/healthz', health);
    app.get('/', health);
    app.get('/mcp', mcpHandler);
    app.get('/v1/mcp', mcpHandler);
    app.post('/mcp', mcpHandler);
    app.post('/v1/mcp', mcpHandler);
    app.delete('/mcp', mcpHandler);
    app.delete('/v1/mcp', mcpHandler);

    if (proxyUrl) {
      const { daemonHttpProxy } = await import('./daemon-http-proxy.ts');
      app.use(daemonHttpProxy(proxyUrl));
    }
    app.listen(Number(httpPort), process.env.HOST ?? '::', () =>
      console.error(
        `[bagseven-mcp] HTTP :${httpPort}/mcp oauth=${oauthRequired} public=${publicUrl || 'unset'} json=true`,
      ),
    );
  } else {
    await buildServer().connect(new StdioServerTransport());
    console.error('[bagseven-mcp] stdio server ready');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error('[bagseven-mcp] fatal', err);
  process.exit(1);
});
