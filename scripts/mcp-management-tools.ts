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
  const readSpending = async (path: string, empty: Record<string, unknown>) => {
    try { return await daemon('GET', path); }
    catch (error) {
      if (!(error instanceof Error) || !/NOT_FOUND: no agent found/.test(error.message)) throw error;
      return { ...empty, mode: 'entitlements_only', requires_spending_permission: true,
        next_step: 'Open Bagseven /app/mandate to create owner-signed spending permission and fund it with your wallet. Prepaid entitlements remain available.' };
    }
  };
  const query = (id?: string) => id ? `?mandate_id=${encodeURIComponent(id)}` : '';
  server.registerTool('list_mandates', { title: 'List owner mandates', description: 'Discover mandates owned by the bound worker’s owner. No wallet or UUID is required.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(await readSpending(`${prefix}/mandates`, { mandates: [] })));
  server.registerTool('get_mandate', { title: 'Mandate and live budget', description: 'Read signed terms, actual USDT vault balance, budget, agent tree and refusals. Defaults to the bound mandate.', inputSchema: { mandate_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async ({ mandate_id }) => text(await readSpending(`${prefix}/mandate${query(mandate_id)}`, { mandate: null })));
  server.registerTool('list_agents', { title: 'List mandate agents', description: 'Discover root and child agents of an owned mandate; defaults to the bound mandate.', inputSchema: { mandate_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async ({ mandate_id }) => text(await readSpending(`${prefix}/agents${query(mandate_id)}`, { agents: [] })));
  server.registerTool('get_agent', { title: 'Agent and capacity', description: 'Read an owned agent, its mandate and remaining capacity. Omit agent_id for the bound worker.', inputSchema: { agent_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async ({ agent_id }) => text(await readSpending(`${prefix}/agents/${encodeURIComponent(agent_id ?? worker)}`, { agent: null })));
  server.registerTool('prepare_mandate', { title: 'Prepare owner mandate approval', description: 'Prepare exact terms and the canonical message for the current owner to sign with their wallet. Does not deploy or move funds.', inputSchema: terms, annotations: { readOnlyHint: true } }, async input => text(await daemon('POST', `${prefix}/mandates/prepare`, input)));
  server.registerTool('create_mandate', { title: 'Create owner-signed mandate', description: 'Deploy a mandate and register its root agent after the owner signs the message from prepare_mandate. Never accepts private keys.', inputSchema: { ...terms, signature }, annotations: { readOnlyHint: false } }, async input => text(await daemon('POST', `${prefix}/mandates`, input)));
  server.registerTool('prepare_mandate_funding', { title: 'Prepare USDT vault funding', description: 'Return an unsigned USDT transaction for wallet approval. Defaults to the current vault; does not transfer money automatically.', inputSchema: { amount: z.string(), mandate_id: uuid.optional() }, annotations: { readOnlyHint: true } }, async input => text(await daemon('POST', `${prefix}/mandate/funding`, input)));
  server.registerTool('list_agent_entitlements', { title: 'Agent living entitlements', description: 'List live grants available to this worker, including unbound prepaid grants, optionally filtered by feature. Expired grants are absent.', inputSchema: { feature: z.string().optional() }, annotations: { readOnlyHint: true } }, async ({ feature }) => {
    const params = new URLSearchParams(); if (feature) params.set('feature', feature);
    const live = await daemon('GET', `/internal/grants/live?${params}`) as { grants?: Array<{ worker_id?: string }> };
    return text({ ...live, grants: (live.grants ?? []).filter(g => !g.worker_id || g.worker_id === worker) });
  });
  server.registerTool('list_subscriptions', { title: 'Recurring subscriptions', description: 'Read recurring subscription status, current paid period, attempts and payment receipts. Optionally filter by holder.', inputSchema: { holder: z.string().optional() }, annotations: { readOnlyHint: true } }, async ({ holder }) => text(await daemon('GET', `/v1/subscriptions${holder ? `?${new URLSearchParams({ holder })}` : ''}`)));
  server.registerTool('get_subscription', { title: 'Subscription status', description: 'Read one recurring subscription and its last collection outcome.', inputSchema: { subscription_id: z.string().min(1) }, annotations: { readOnlyHint: true } }, async ({ subscription_id }) => text(await daemon('GET', `/v1/subscriptions/${encodeURIComponent(subscription_id)}`)));
  server.registerTool('cancel_subscription', { title: 'Prepare subscription cancellation', description: 'Return an unsigned cancellation transaction for the paying wallet. Does not sign, broadcast, or claim that cancellation is complete.', inputSchema: { subscription_id: z.string().min(1) }, annotations: { readOnlyHint: true } }, async ({ subscription_id }) => {
    const sub = await daemon('GET', `/v1/subscriptions/${encodeURIComponent(subscription_id)}`) as { subscription: { checkout_id: string } };
    return text({ ...await daemon('POST', `/v1/subscriptions/${encodeURIComponent(subscription_id)}/cancel`, {}) as object, management_url: `${process.env.CONSOLE_URL || 'http://localhost:3000'}/checkout?session=${encodeURIComponent(sub.subscription.checkout_id)}` });
  });
  server.registerTool('list_features', { title: 'Feature catalog', description: 'List available capability SKUs and whether they are boolean or metered.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(await daemon('GET', '/internal/features')));
  server.registerTool('list_plans', { title: 'List provider plans', description: 'Discover provider checkout plans, prices, credits and payout wallets.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(await daemon('GET', '/v1/plans')));
  server.registerTool('create_plan', { title: 'Create provider plan', description: 'Create a plan with the provider payout wallet. Customer payments go directly to that wallet; the platform fee is billed separately.', inputSchema: { name: z.string().min(1), feature: z.string().min(1), amount: z.string(), credits: z.string(), ttl_seconds: z.number().int().positive(), merchant_wallet: address, interval: z.enum(['once', 'month']).default('once') }, annotations: { readOnlyHint: false } }, async input => text(await daemon('POST', '/v1/plans', input)));
  server.registerTool('get_checkout_session', { title: 'Checkout payment status', description: 'Read a checkout’s payment state, entitlement and accrued provider fee.', inputSchema: { checkout_id: z.string().min(1) }, annotations: { readOnlyHint: true } }, async ({ checkout_id }) => text(await daemon('GET', `/v1/checkout-sessions/${encodeURIComponent(checkout_id)}`)));
}
