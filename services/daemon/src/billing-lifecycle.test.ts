import { describe, expect, it, vi } from 'vitest';
import { ReceiptMailer, type ReceiptDelivery, type ReceiptDeliveryStore } from './billing-lifecycle.js';
const job: ReceiptDelivery = { document_id: 'inv_' + 'a'.repeat(32), recipient: 'customer@example.com', attempts: 1,
  created_at: new Date('2026-11-13T10:00:00Z'), first_attempt_at: new Date('2026-11-13T10:00:00Z'), provider_id: 'merchant', payment_tx: '0x' + 'ab'.repeat(32),
  terms: { planId: 'plan', planName: 'Receipt Starter', feature: 'ocr', amount: '1', chainId: 43113,
    token: '0x5425890298aed601595a70AB815c96711a31Bc65', merchant: '0x' + '1'.repeat(40), kind: 'once' } };
const env = { CONSOLE_URL: 'https://console.example.com', ENTITLEMENT_SUBJECT_SECRET: 'test-secret'.repeat(5) };
function store(): ReceiptDeliveryStore {
  return { claim: vi.fn(async () => [job]), sent: vi.fn(async () => {}), retry: vi.fn(async () => {}) };
}
describe('paid invoice email delivery', () => {
  it('sends to the customer with a document-scoped link and stable retry payload after an uncertain acknowledgement', async () => {
    const queue = store();
    vi.mocked(queue.sent).mockRejectedValueOnce(Error('Connection lost after send'));
    const send = vi.fn(async () => ({ ok: true, id: 'provider-email-id' }));
    const mailer = new ReceiptMailer(queue, env, send, () => true);
    await mailer.tick(); await mailer.tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    const payload = vi.mocked(send).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(payload[0]).toMatchObject({ to: 'customer@example.com', event: 'billing_receipt', idempotencyKey: 'bagseven-receipt-' + job.document_id });
    expect(payload[0].href).toContain('/billing/' + job.document_id + '?access=');
    expect(queue.retry).toHaveBeenCalledOnce();
  });
  it('does not mark a skipped or rejected notification as sent', async () => {
    for (const result of [{ ok: true, skipped: 'NOTIFY_MODE=log' }, { ok: false, error: 'unavailable' }]) {
      const queue = store();
      await new ReceiptMailer(queue, env, vi.fn(async () => result), () => true).tick();
      expect(queue.sent).not.toHaveBeenCalled(); expect(queue.retry).toHaveBeenCalledOnce();
    }
  });
  it('keeps the queue intact when delivery is unconfigured', async () => {
    const queue = store();
    await new ReceiptMailer(queue, env, vi.fn(), () => false).tick();
    expect(queue.claim).not.toHaveBeenCalled();
  });
});
