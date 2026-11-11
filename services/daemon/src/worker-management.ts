import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '@bagseven/server';
import { canonicalMandate, avalancheConfig } from '@bagseven/onchain';
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { usdtUnits } from './avalanche-payment.js';

export type WorkerScope = { agent: { id: string; operator_address: string }; mandate: { id: string; owner_address: string; contract_address: string } };
const terms = z.object({
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  budget_per_window: z.string(), window_seconds: z.number().int().positive(), lifetime_cap: z.string(),
  per_purchase_cap: z.string(), per_seller_pct: z.number().int().min(0).max(10000), max_depth: z.number().int().min(0).max(10),
});
export function registerWorkerManagement(app: FastifyInstance, deps: {
  config: NodeJS.ProcessEnv;
  resolve: (worker: string) => Promise<WorkerScope>;
  policy: (method: string, path: string, body?: unknown) => Promise<unknown>;
}) {
  const { config, policy } = deps;
  async function scope(worker: string, mandateId?: string) {
    const bound = await deps.resolve(worker);
    const id = mandateId ?? bound.mandate.id;
    const details = await policy('GET', `/v1/mandates/${encodeURIComponent(id)}`) as { mandate: { id: string; owner_address: string; contract_address: string }; token_address?: string; agents: unknown[] };
    if (details.mandate.owner_address.toLowerCase() !== bound.mandate.owner_address.toLowerCase()) throw new ApiError(403, 'MANDATE_SCOPE', 'This mandate belongs to another owner');
    return { bound, details };
  }
  app.get('/internal/workers/:worker/mandates', async req => {
    const { worker } = req.params as { worker: string };
    const bound = await deps.resolve(worker);
    return policy('GET', `/v1/mandates?owner_address=${encodeURIComponent(bound.mandate.owner_address)}`);
  });
  app.get('/internal/workers/:worker/mandate', async req => {
    const { worker } = req.params as { worker: string };
    const q = req.query as { mandate_id?: string };
    const { details } = await scope(worker, q.mandate_id);
    const overview = await policy('GET', `/v1/mandates/${details.mandate.id}/overview`);
    return { ...details, overview, chain_id: avalancheConfig(config).chainId, token: avalancheConfig(config).usdt };
  });
  app.get('/internal/workers/:worker/agents', async req => {
    const { worker } = req.params as { worker: string };
    const q = req.query as { mandate_id?: string };
    const { details } = await scope(worker, q.mandate_id);
    return { mandate_id: details.mandate.id, agents: details.agents };
  });
  app.get('/internal/workers/:worker/agents/:agent', async req => {
    const { worker, agent } = req.params as { worker: string; agent: string };
    const [bound, selected] = await Promise.all([deps.resolve(worker), deps.resolve(agent)]);
    if (bound.mandate.owner_address.toLowerCase() !== selected.mandate.owner_address.toLowerCase()) throw new ApiError(403, 'AGENT_SCOPE', 'This agent belongs to another owner');
    return selected;
  });
  async function prepare(worker: string, raw: unknown) {
    const body = terms.parse(raw);
    const bound = await deps.resolve(worker);
    for (const amount of [body.budget_per_window, body.lifetime_cap, body.per_purchase_cap]) usdtUnits(amount);
    const chainId = avalancheConfig(config).chainId;
    const payload = { ...body, owner_address: bound.mandate.owner_address, chain_id: chainId };
    const message = canonicalMandate({ owner: payload.owner_address.toLowerCase() as Address, operator: body.operator_address.toLowerCase() as Address,
      budgetPerWindow: body.budget_per_window, windowSeconds: body.window_seconds, lifetimeCap: body.lifetime_cap,
      perPurchaseCap: body.per_purchase_cap, perSellerPct: body.per_seller_pct, maxDepth: body.max_depth, chainId });
    return { owner_address: payload.owner_address, chain_id: chainId, message, payload, requires_owner_signature: true };
  }
  app.post('/internal/workers/:worker/mandates/prepare', async req => prepare((req.params as { worker: string }).worker, req.body));
  app.post('/internal/workers/:worker/mandates', async req => {
    const raw = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).passthrough().parse(req.body);
    const prepared = await prepare((req.params as { worker: string }).worker, raw);
    return policy('POST', '/v1/mandates', { ...prepared.payload, signature: raw.signature });
  });
  app.post('/internal/workers/:worker/mandate/funding', async req => {
    const body = z.object({ amount: z.string(), mandate_id: z.string().uuid().optional() }).parse(req.body);
    const { details } = await scope((req.params as { worker: string }).worker, body.mandate_id);
    const rail = avalancheConfig(config);
    if (details.token_address?.toLowerCase() !== rail.usdt.toLowerCase()) throw new ApiError(409, 'MANDATE_TOKEN_MISMATCH', 'This vault uses another token; do not fund it with the checkout token');
    return { mandate_id: details.mandate.id, chain_id: rail.chainId, token: rail.usdt, amount: body.amount,
      recipient: details.mandate.contract_address, requires_wallet_approval: true,
      transaction: { to: rail.usdt, value: '0', data: encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns(bool)']), functionName: 'transfer', args: [details.mandate.contract_address as Address, usdtUnits(body.amount)] }) } };
  });
}
