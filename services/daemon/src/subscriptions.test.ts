import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { MemoryGrantStore } from '@bagseven/entitlements';
import { PlanSchema } from './billing-store.js';
import { MemorySubscriptionStore } from './subscription-store.js';
import { Subscriptions } from './subscriptions.js';
import type { Subscription, SubscriptionPlan } from './subscription-types.js';
import type { ChainPayment, ChainState, SubscriptionChain } from './subscription-chain.js';

const now = 1800000000;
const period = 30 * 86400;
const hash = `0x${'11'.repeat(32)}`;
const plan = PlanSchema.parse({ id: 'plan_monthly', provider_id: 'provider', name: 'Pro', amount: '2', credits: '10',
  feature: 'ocr', interval: 'month', ttl_seconds: period, merchant_wallet: `0x${'22'.repeat(20)}`, created_at: new Date(now * 1000).toISOString() });

class FakeChain implements SubscriptionChain {
  stateValue: ChainState = { payer: `0x${'33'.repeat(20)}`, paidThrough: now, payments: 1, cancelled: false, balance: 10000000n, allowance: 10000000n };
  confirmed = new Map<string, ChainPayment>();
  signed = vi.fn(async () => ({ raw: '0xsigned', hash }));
  send = vi.fn(async () => {});
  ready = false;
  preparePlan = vi.fn(async (): Promise<SubscriptionPlan> => ({ id: plan.id, providerId: 'provider', contract: `0x${'44'.repeat(20)}`, chainId: 1874, status: 'preparing', raw: '0xdeploy', hash }));
  async verifyPlan() { return this.ready; }
  async broadcast(raw: string) { await this.send(raw); }
  async state() { return this.stateValue; }
  async signCharge() { return this.signed(); }
  async payment(paymentHash: string) { return this.confirmed.get(paymentHash) ?? null; }
}
function subscription(): Subscription {
  return { id: 'subscription', checkoutId: 'checkout', holder: 'holder', providerId: 'provider', plan, chainId: 1874,
    contract: `0x${'44'.repeat(20)}`, key: `0x${'55'.repeat(32)}`, payer: `0x${'33'.repeat(20)}`,
    status: 'ACTIVE', paidThrough: now, nextAttemptAt: now + 120, failures: 0,
    grantId: 'prior-grant', paymentTx: `0x${'66'.repeat(32)}` };
}
async function fixture() {
  const store = new MemorySubscriptionStore(); const chain = new FakeChain(); const grants = new MemoryGrantStore();
  await store.save(subscription());
  return { store, chain, grants, service: new Subscriptions(store, chain, grants) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime((now + 120) * 1000); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('durable recurring collection', () => {
  it('recovers a crash between the initial subscription and payment-journal saves before any renewal', async () => {
    const { store, chain, grants } = await fixture();
    const initial = { ...subscription(), grantId: '', status: 'RECONCILIATION_REQUIRED' as const };
    await store.save(initial);
    chain.confirmed.set(initial.paymentTx, { hash: initial.paymentTx, paidAt: now - period, paidThrough: now, payer: initial.payer, period: 1 });
    // Still inside the paid period when the restarted worker first sees the orphan.
    vi.setSystemTime((now - 60) * 1000);
    await new Subscriptions(store, chain, grants).process(initial.id);
    const recovered = (await store.get(initial.id))!;
    expect(recovered.grantId).not.toBe('');
    expect((await store.period(`${initial.id}:initial`))?.stage).toBe('complete');
    expect((await grants.get(recovered.grantId))?.payment_tx).toBe(initial.paymentTx);
    expect(chain.signed).not.toHaveBeenCalled();
  });
  it('never renews an orphan whose original payment cannot be recovered', async () => {
    const { store, chain, service } = await fixture();
    await store.save({ ...subscription(), grantId: '', status: 'RECONCILIATION_REQUIRED' });
    await service.process('subscription');
    expect(chain.signed).not.toHaveBeenCalled();
    expect((await store.get('subscription'))?.status).toBe('RECONCILIATION_REQUIRED');
  });
  it('recovers signing committed before the per-subscription journal, even after chain settlement', async () => {
    const { store, chain, grants } = await fixture();
    const recoveredChain: SubscriptionChain = Object.assign(chain, { recoverCharge: async () => ({ raw: '0xalready-signed', hash }) });
    chain.confirmed.set(hash, { hash, paidAt: now + 120, paidThrough: now + period, payer: subscription().payer, period: 2 });
    chain.stateValue.paidThrough = now + period;
    await new Subscriptions(store, recoveredChain, grants).process('subscription');
    expect((await store.get('subscription'))?.paidThrough).toBe(now + period);
    expect(await grants.findLive({ holder: 'holder' })).toHaveLength(1);
    expect(chain.signed).not.toHaveBeenCalled();
  });
  it('journals the signed bytes before broadcast and submits once across concurrent workers', async () => {
    const { store, chain, service } = await fixture();
    chain.send.mockImplementation(async () => { expect((await store.period(`subscription:${now}`))?.raw).toBe('0xsigned'); });
    await Promise.all([service.process('subscription'), service.process('subscription')]);
    expect(chain.signed).toHaveBeenCalledTimes(1); expect(chain.send).toHaveBeenCalledTimes(1);
  });
  it('recovers a confirmed payment after restart without paying again, then creates one grant', async () => {
    const { store, chain, grants, service } = await fixture();
    await service.process('subscription');
    chain.confirmed.set(hash, { hash, paidAt: now + 120, paidThrough: now + period, payer: subscription().payer, period: 2 });
    await new Subscriptions(store, chain, grants).process('subscription');
    const result = (await store.get('subscription'))!;
    expect(result.status).toBe('ACTIVE'); expect(result.paidThrough).toBe(now + period);
    expect((await grants.get(result.grantId))?.remaining).toBe('10');
    await service.process('subscription');
    expect(chain.signed).toHaveBeenCalledTimes(1); expect(await grants.findLive({ holder: 'holder' })).toHaveLength(1);
  });
  it('keeps an ambiguous broadcast attached to the same bytes and hash', async () => {
    const { store, chain, service } = await fixture();
    chain.send.mockRejectedValueOnce(Error('RPC disconnected after broadcast'));
    await service.process('subscription'); await service.process('subscription');
    expect(chain.signed).toHaveBeenCalledTimes(1);
    expect(chain.send.mock.calls.map(c => c[0])).toEqual(['0xsigned', '0xsigned']);
    expect((await store.get('subscription'))?.failures).toBe(0);
  });
  it('does not mint twice when an Arkiv broadcast outcome is unknown', async () => {
    const { store, chain, grants, service } = await fixture();
    await service.process('subscription');
    chain.confirmed.set(hash, { hash, paidAt: now + 120, paidThrough: now + period, payer: subscription().payer, period: 2 });
    const mint = vi.spyOn(grants, 'mint').mockRejectedValueOnce(Error('Arkiv broadcast unknown'));
    await service.process('subscription'); await service.process('subscription');
    expect(mint).toHaveBeenCalledTimes(1); expect((await store.get('subscription'))?.status).toBe('RECONCILIATION_REQUIRED');
    const journal = (await store.period(`subscription:${now}`))!;
    mint.mockRestore();
    // The original signed Arkiv write becomes visible, as it would after index recovery.
    await grants.mint({ id: journal.grantId, holder: 'holder', merchant: 'provider', feature: 'ocr', remaining: '10',
      ttl_seconds: period, payment_tx: hash, settlement_network: 'whitechain', renewal_enabled: true });
    await service.process('subscription');
    expect((await store.get('subscription'))?.status).toBe('ACTIVE');
    expect(chain.signed).toHaveBeenCalledTimes(1);
  });
  it('retries customer funding failures at the fixed offsets and ends after four failures', async () => {
    const { store, chain, service } = await fixture(); chain.stateValue.balance = 0n;
    for (const offset of [120, 3600, 21600, 86400]) {
      vi.setSystemTime((now + offset) * 1000); await service.process('subscription');
    }
    const result = (await store.get('subscription'))!;
    expect(result.failures).toBe(4); expect(result.status).toBe('ENDED'); expect(result.attempts).toHaveLength(4);
    expect(chain.signed).not.toHaveBeenCalled();
  });
  it('does not count technical outages as customer failures', async () => {
    const { store, chain, service } = await fixture();
    vi.spyOn(chain, 'state').mockRejectedValueOnce(Error('RPC offline'));
    await service.process('subscription');
    expect((await store.get('subscription'))?.failures).toBe(0);
    expect(chain.signed).not.toHaveBeenCalled();
  });
  it('honors on-chain cancellation and preserves the already-paid period', async () => {
    const { store, chain, service } = await fixture(); chain.stateValue.cancelled = true;
    await service.process('subscription');
    expect((await store.get('subscription'))?.status).toBe('CANCELLED');
    expect((await store.get('subscription'))?.paidThrough).toBe(now);
    expect(chain.signed).not.toHaveBeenCalled();
  });
  it('does not sign back-billing transactions after the collection window', async () => {
    const { store, chain, service } = await fixture(); vi.setSystemTime((now + 86701) * 1000);
    await service.process('subscription');
    expect((await store.get('subscription'))?.status).toBe('ENDED'); expect(chain.signed).not.toHaveBeenCalled();
  });
  it('resumes a preparing plan from committed bytes rather than deploying twice', async () => {
    const { store, chain, service } = await fixture();
    chain.send.mockRejectedValueOnce(Error('ambiguous deploy'));
    await expect(service.prepare(plan)).rejects.toThrow('ambiguous');
    expect((await store.plan(plan.id))?.raw).toBe('0xdeploy');
    chain.ready = true; await service.prepare(plan);
    expect(chain.preparePlan).toHaveBeenCalledTimes(1); expect((await store.plan(plan.id))?.status).toBe('ready');
  });
});
