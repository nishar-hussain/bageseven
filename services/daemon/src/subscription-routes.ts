import type { FastifyInstance } from 'fastify';
import { ApiError } from '@bagseven/server';
import { authenticateRequest, assertCanWrite } from './api-keys.js';
import { providerScope } from './billing.js';
import { Subscriptions } from './subscriptions.js';
import type { Subscription } from './subscription-types.js';
import { encodeFunctionData, type Hex } from 'viem';
import { SubscriptionAbi, whitechainConfig } from '@bagseven/onchain';

export const subscriptionView = (sub: Subscription) => ({
  id: sub.id, checkout_id: sub.checkoutId, holder: sub.holder, plan_id: sub.plan.id, feature: sub.plan.feature,
  amount: sub.plan.amount, credits: sub.plan.credits, period_seconds: sub.plan.ttl_seconds, status: sub.status,
  contract: sub.contract, subscription_key: sub.key, chain_id: sub.chainId, payer: sub.payer,
  paid_through: new Date(sub.paidThrough * 1000).toISOString(), next_attempt_at: new Date(sub.nextAttemptAt * 1000).toISOString(),
  failures: sub.failures, last_error: sub.lastError ?? null, grant_id: sub.grantId, payment_tx: sub.paymentTx,
  attempts: sub.attempts ?? [],
  token: whitechainConfig().usdt,
  cancel_data: encodeFunctionData({ abi: SubscriptionAbi, functionName: 'cancel', args: [sub.key as Hex] }),
});
export const cancellationDraft = (sub: Subscription) => ({
  requires_wallet_approval: true, subscription_id: sub.id, payer: sub.payer, chain_id: sub.chainId,
  transaction: { to: sub.contract, value: '0x0', data: encodeFunctionData({ abi: SubscriptionAbi, functionName: 'cancel', args: [sub.key as Hex] }) },
  note: 'Sign cancellation with the paying wallet, then sync the subscription. Existing paid access remains valid.',
});

export function registerSubscriptionRoutes(app: FastifyInstance, service: Subscriptions) {
  async function authorized(req: { headers: { authorization?: string } }, id: string) {
    const principal = authenticateRequest(req.headers.authorization, process.env);
    if (principal.kind === 'pk') throw new ApiError(403, 'FORBIDDEN', 'A holder token or secret key is required');
    const sub = await service.store.get(id);
    const provider = providerScope(req);
    if (!sub || (provider && sub.providerId !== provider)) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    assertCanWrite(principal, sub.holder);
    return sub;
  }
  app.get('/v1/subscriptions', async req => {
    const principal = authenticateRequest(req.headers.authorization, process.env);
    if (principal.kind === 'pk') throw new ApiError(403, 'FORBIDDEN', 'A holder token or secret key is required');
    const query = req.query as { holder?: string };
    if (principal.kind === 'embed' && query.holder && query.holder !== principal.holder) throw new ApiError(403, 'HOLDER_MISMATCH', 'Holder does not match this token');
    const holder = principal.kind === 'embed' ? principal.holder : query.holder;
    const provider = providerScope(req);
    return { subscriptions: (await service.store.list(holder)).filter(s => !provider || s.providerId === provider).map(subscriptionView) };
  });
  app.get('/v1/subscriptions/:id', async req => ({ subscription: subscriptionView(await authorized(req, (req.params as { id: string }).id)) }));
  app.post('/v1/subscriptions/:id/cancel', async req => cancellationDraft(await authorized(req, (req.params as { id: string }).id)));
  app.post('/v1/subscriptions/:id/sync', async req => {
    const sub = await authorized(req, (req.params as { id: string }).id);
    const updated = await service.store.lock(sub.id, async () => service.syncCancellation((await service.store.get(sub.id))!));
    if (!updated) throw new ApiError(409, 'SUBSCRIPTION_BUSY', 'Subscription is being updated; retry');
    return { subscription: subscriptionView(updated) };
  });
  // Checkout already exposes payment status by unguessable session ID. These
  // operations reveal the same purchase and only reconcile an owner-signed chain cancellation.
  app.get('/v1/public/checkout/:id/subscription', async req => {
    const sub = await service.store.get(`sub_${(req.params as { id: string }).id}`);
    return { subscription: sub ? subscriptionView(sub) : null };
  });
  app.post('/v1/public/checkout/:id/subscription/sync', async req => {
    const sub = await service.store.get(`sub_${(req.params as { id: string }).id}`);
    if (!sub) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    const updated = await service.store.lock(sub.id, async () => service.syncCancellation((await service.store.get(sub.id))!));
    if (!updated) throw new ApiError(409, 'SUBSCRIPTION_BUSY', 'Subscription is being updated; retry');
    return { subscription: subscriptionView(updated) };
  });
}
