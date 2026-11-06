import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type Daemon = (method: string, path: string, body?: unknown) => Promise<unknown>;
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const uuid = z.string().uuid();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const terms = {
  operator_address: address,
  budget_per_window: z.string(), window_seconds: z.number().int().positive(), lifetime_cap: z.string(),
  per_purchase_cap: z.string(), per_seller_pct: z.number().int().min(0).max(10000), max_depth: z.number().int().min(0).max(10),
};
export function registerManagementTools(server: McpServer, worker: string, daemon: Daemon) {
  const prefix = `/internal/workers/${encodeURIComponent(worker)}`;
  const query = (id?: string) => id ? `?mandate_id=${encodeURIComponent(id)}` : '';
  server.registerTool('list_mandates', { title: 'List owner mandates', description: 'Discover mandates owned by the bound worker’s owner. No wallet or UUID is required.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(await daemon('GET', `${prefix}/mandates`)));
  server.registerTool('get_mandate', { title: 'Mandate and live budget', description: 'Read signed terms, actual USDT vault balance, budget, agent tree and refusals. Defaults to the bound mandate.', inputSchema: { mandate_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async ({ mandate_id }) => text(await daemon('GET', `${prefix}/mandate${query(mandate_id)}`)));
  server.registerTool('list_agents', { title: 'List mandate agents', description: 'Discover root and child agents of an owned mandate; defaults to the bound mandate.', inputSchema: { mandate_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async ({ mandate_id }) => text(await daemon('GET', `${prefix}/agents${query(mandate_id)}`)));
  server.registerTool('get_agent', { title: 'Agent and capacity', description: 'Read an owned agent, its mandate and remaining capacity. Omit agent_id for the bound worker.', inputSchema: { agent_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async ({ agent_id }) => text(await daemon('GET', `${prefix}/agents/${encodeURIComponent(agent_id ?? worker)}`)));
  server.registerTool('prepare_mandate', { title: 'Prepare owner mandate approval', description: 'Prepare exact terms and the canonical message for the current owner to sign with their wallet. Does not deploy or move funds.', inputSchema: terms, annotations: { readOnlyHint: true } }, async input => text(await daemon('POST', `${prefix}/mandates/prepare`, input)));
  server.registerTool('create_mandate', { title: 'Create owner-signed mandate', description: 'Deploy a mandate and register its root agent after the owner signs the message from prepare_mandate. Never accepts private keys.', inputSchema: { ...terms, signature }, annotations: { readOnlyHint: false } }, async input => text(await daemon('POST', `${prefix}/mandates`, input)));
  server.registerTool('prepare_mandate_funding', { title: 'Prepare USDT vault funding', description: 'Return an unsigned USDT transaction for wallet approval. Defaults to the current vault; does not transfer money automatically.', inputSchema: { amount: z.string(), mandate_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async input => text(await daemon('POST', `${prefix}/mandate/funding`, input)));
  server.registerTool('list_agent_entitlements', { title: 'Agent living entitlements', description: 'List live grants bound to this worker, optionally filtered by feature. Expired grants are absent.', inputSchema: { feature: z.string().optional() }, annotations: { readOnlyHint: true } }, async ({ feature }) => {
    const params = new URLSearchParams({ worker_id: worker }); if (feature) params.set('feature', feature);
    return text(await daemon('GET', `/internal/grants/live?${params}`));
  });
  server.registerTool('list_features', { title: 'Feature catalog', description: 'List available capability SKUs and whether they are boolean or metered.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(await daemon('GET', '/internal/features')));
  server.registerTool('list_plans', { title: 'List provider plans', description: 'Discover provider checkout plans, prices, credits and payout wallets.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(await daemon('GET', '/v1/plans')));
  server.registerTool('create_plan', { title: 'Create provider plan', description: 'Create a plan with the provider payout wallet. Customer payments go directly to that wallet; the platform fee is billed separately.', inputSchema: { name: z.string().min(1), feature: z.string().min(1), amount: z.string(), credits: z.string(), ttl_seconds: z.number().int().positive(), merchant_wallet: address, interval: z.enum(['once', 'month']).default('once') }, annotations: { readOnlyHint: false } }, async input => text(await daemon('POST', '/v1/plans', input)));
  server.registerTool('get_checkout_session', { title: 'Checkout payment status', description: 'Read a checkout’s payment state, entitlement and accrued provider fee.', inputSchema: { checkout_id: z.string().min(1) }, annotations: { readOnlyHint: true } }, async ({ checkout_id }) => text(await daemon('GET', `/v1/checkout-sessions/${encodeURIComponent(checkout_id)}`)));
}
