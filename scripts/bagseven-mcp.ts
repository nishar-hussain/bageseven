/**
 * Bagseven MCP — the agent-facing protocol adapter.
 *
 * MCP deliberately contains no wallet or policy logic. It forwards requests
 * to the Bagseven daemon, which identifies the worker, signs the request and
 * calls the policy/mandate services.
 */
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
const RESEARCH_PROVIDER = process.env.RESEARCH_PROVIDER_URL ?? 'http://127.0.0.1:4010';

async function daemon(method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
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
    throw new Error(`Bagseven daemon is unreachable at ${DAEMON}; start the daemon on port 4001 (${(error as Error).message})`);
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

function buildServer(): McpServer {
  if (!WORKER) throw new Error('BAGSEVEN_MCP_WORKER must bind this MCP instance to one worker');
  const server = new McpServer({ name: 'bagseven-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.registerTool(
    'bagseven_status',
    {
      title: 'Bagseven worker status',
      description: 'Read the worker identity, mandate limits and live remaining vault capacity.',
      inputSchema: {},
    },
    async () => text(await daemon('POST', `/internal/workers/${encodeURIComponent(WORKER)}/status`)),
  );

  server.registerTool(
    'bagseven_search',
    {
      title: 'Bagseven research search',
      description: 'Search research providers available to this Bagseven agent.',
      inputSchema: { query: z.string().min(1).max(500) },
    },
    async ({ query }) => {
      const response = await fetch(`${RESEARCH_PROVIDER}/v1/providers?query=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`research provider search failed (${response.status})`);
      const catalog = await response.json() as { providers?: Array<{ resources?: Array<{ id: string; title: string; category: string; price: string; provider: string; free: boolean; summary: string }> }> };
      const resources = (catalog.providers ?? []).flatMap((provider) => provider.resources ?? []).filter((resource) => `${resource.title} ${resource.category} ${resource.summary}`.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes('electric vehicle'));
      return text({ query, resources });
    },
  );

  server.registerTool(
    'bagseven_fetch',
    {
      title: 'Bagseven controlled payment',
      description: 'Request a direct payment or fetch a paid HTTP resource. The Bagseven daemon handles the payment challenge, policy evaluation and mandate settlement.',
      inputSchema: {
        url: z.string().url().optional().describe('paid HTTP resource; the daemon will handle a 402 payment challenge'),
        amount: z.string().min(1).optional().describe('direct USDC amount, for example 0.10'),
        recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe('direct recipient wallet address'),
        reason: z.string().max(500).optional().describe('audit reason'),
      },
    },
    async ({ url, amount, recipient, reason }) => {
      const cleanUrl = url?.trim() || undefined;
      // For an x402 URL, the daemon must derive amount and recipient from the
      // provider's signed 402 challenge. Ignore any extra values hallucinated
      // by the model, which may be empty, formatted as currency, or invalid.
      const request = cleanUrl
        ? { url: cleanUrl, reason: reason?.trim() || undefined }
        : {
            // Models commonly serialize optional fields as empty strings.
            // Remove those values before daemon validation.
            amount: amount?.trim() || undefined,
            recipient: recipient?.trim() || undefined,
            reason: reason?.trim() || undefined,
          };
      return text(await daemon('POST', `/internal/workers/${encodeURIComponent(WORKER)}/fetch`, request));
    },
  );

  server.registerTool(
    'bagseven_spawn',
    {
      title: 'Bagseven child worker',
      description: 'Create a child worker under an existing Bagseven mandate.',
      inputSchema: {
        mandate_id: z.string().uuid(),
        parent_agent_id: z.string().uuid(),
        operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        share_percent: z.number().int().min(1).max(100),
      },
    },
    async ({ mandate_id, parent_agent_id, operator_address, share_percent }) => text(await daemon('POST', `/internal/workers/${encodeURIComponent(WORKER)}/spawn`, { mandate_id, parent_agent_id, operator_address, share_percent })),
  );

  // --- Public entitlement tools (access clock). Mandate caps money; grants cap features. ---

  server.registerTool(
    'grant_status',
    {
      title: 'Live entitlement status',
      description: 'List living grants (Arkiv/query surface). Expired grants disappear — that is the access clock.',
      inputSchema: {
        holder: z.string().optional(),
        feature: z.string().optional(),
      },
    },
    async ({ holder, feature }) => {
      const params = new URLSearchParams();
      if (holder) params.set('holder', holder);
      if (feature) params.set('feature', feature);
      params.set('worker_id', WORKER);
      const qs = params.toString();
      return text(await daemon('GET', `/internal/grants/live?${qs}`));
    },
  );

  server.registerTool(
    'mint_with_world',
    {
      title: 'Mint grant with World gate',
      description:
        'Mint a public Arkiv entitlement after World Agent Pass backend verify. Deny path: world_denied, outcome=cancelled|expired|invalid, or world:cancel:* proof — writes nothing.',
      inputSchema: {
        feature: z.string().min(1).default('ocr'),
        holder: z.string().min(1),
        human_id: z.string().optional(),
        remaining: z.string().default('10'),
        ttl_seconds: z.number().int().positive().default(120),
        payment_tx: z.string().optional(),
        settlement_network: z.enum(['hedera', 'avalanche_fuji', 'local']).default('hedera'),
        world_proof_id: z.string().optional().describe('world:ok:<id> or world:cancel|expire|deny:<id>'),
        id_token: z.string().optional().describe('OIDC ID token in live World mode'),
        world_denied: z.boolean().optional(),
        outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
        renewal_enabled: z.boolean().default(true),
      },
    },
    async (input) => text(await daemon('POST', '/internal/grants/mint', {
      ...input,
      mandate_id: undefined,
      worker_id: WORKER,
    })),
  );

  server.registerTool(
    'buy_credits',
    {
      title: 'Buy / top up credits',
      description: 'Hedera x402 settle → HashScan payment_tx on grant → extend Arkiv access clock.',
      inputSchema: {
        feature: z.string().min(1).default('ocr'),
        holder: z.string().min(1),
        remaining: z.string().default('10'),
        ttl_seconds: z.number().int().positive().default(120),
        payment_tx: z.string().optional().describe('Existing HashScan tx id; omit to settle via facilitator/demo'),
        amount: z.string().default('1.00'),
        human_id: z.string().optional(),
        world_proof_id: z.string().optional(),
      },
    },
    async (input) => text(await daemon('POST', '/internal/grants/buy-credits', {
      ...input,
      worker_id: WORKER,
    })),
  );

  server.registerTool(
    'paid_run',
    {
      title: 'Dual-gate paid work unit',
      description: 'Requires mandate capacity AND living grant with remaining >= cost. Either fail → refuse.',
      inputSchema: {
        grant_id: z.string().min(1),
        amount: z.string().default('1'),
        work: z.string().max(2000).optional(),
        idempotency_key: z.string().optional(),
      },
    },
    async (input) => text(await daemon('POST', '/internal/grants/paid-run', {
      ...input,
      worker_id: WORKER,
    })),
  );

  server.registerTool(
    'cancel_renewal',
    {
      title: 'Cancel renewal only',
      description: 'Turns renewal off without killing access. Grant stays queryable until paid_through (three-clock rule).',
      inputSchema: { grant_id: z.string().min(1) },
    },
    async ({ grant_id }) => text(await daemon('POST', `/internal/grants/${encodeURIComponent(grant_id)}/cancel-renewal`)),
  );

  server.registerTool(
    'explain_denial',
    {
      title: 'Explain dual-gate denial',
      description: 'Structured why: World / expired / empty / mandate — without performing the action.',
      inputSchema: {
        grant_id: z.string().optional(),
        feature: z.string().optional(),
        holder: z.string().optional(),
        amount: z.string().default('1'),
        world_proof_id: z.string().optional(),
        world_denied: z.boolean().optional(),
        outcome: z.enum(['ok', 'denied', 'expired', 'cancelled', 'invalid']).optional(),
      },
    },
    async (input) => text(await daemon('POST', '/internal/grants/explain-denial', {
      ...input,
      worker_id: WORKER,
    })),
  );

  return server;
}

async function main(): Promise<void> {
  if (!WORKER) throw new Error('BAGSEVEN_MCP_WORKER is required');
  const httpPort = process.env.BAGSEVEN_MCP_PORT ?? process.env.MCP_HTTP_PORT;
  if (httpPort) {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
    app.get('/v1/mcp', (_req, res) => {
      // The console uses this unauthenticated localhost health response to
      // confirm that the selected worker-bound process is running. It exposes
      // no secrets and is never a tool or daemon authorization endpoint.
      res.setHeader('access-control-allow-origin', process.env.BAGSEVEN_MCP_CORS_ORIGIN ?? 'http://localhost:3000');
      res.json({ ok: true, service: 'bagseven-mcp', worker: WORKER });
    });
    app.post('/v1/mcp', async (req, res) => {
      if (process.env.MCP_AUTH_TOKEN && req.headers.authorization !== `Bearer ${process.env.MCP_AUTH_TOKEN}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const sessionId = (req.headers['mcp-session-id'] as string) ?? crypto.randomUUID();
      let transport = transports.get(sessionId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, onsessioninitialized: () => undefined });
        transports.set(sessionId, transport);
        await buildServer().connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    });
    app.listen(Number(httpPort), '127.0.0.1', () => console.error(`[bagseven-mcp] HTTP listening on http://127.0.0.1:${httpPort}/v1/mcp`));
  } else {
    await buildServer().connect(new StdioServerTransport());
    console.error('[bagseven-mcp] stdio server ready');
  }
}

main().catch((err) => {
  console.error('[bagseven-mcp] fatal', err);
  process.exit(1);
});
