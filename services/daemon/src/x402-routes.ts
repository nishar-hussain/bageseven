import { desc, eq } from 'drizzle-orm';
import { x402Authorities, x402Jobs } from '@bagseven/db';
import { ApiError } from '@bagseven/server';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Hex } from 'viem';
import type { X402Payments } from './x402-payments.js';
import { providerFromRequest } from './provider-gas.js';

export function registerX402Routes(app: FastifyInstance, payments: X402Payments, env: NodeJS.ProcessEnv) {
  const db = payments.authorities.db;
  const id = (raw: unknown) => z.string().uuid().parse(raw);
  async function owned(req: Parameters<typeof providerFromRequest>[0], jobId: string) {
    const provider = providerFromRequest(req, env);
    const job = await payments.store.get(jobId);
    if (!job || job.data.authority.provider !== provider) throw new ApiError(404, 'NOT_FOUND', 'Payment not found');
    return job;
  }
  app.get('/internal/x402/authorities', async req => {
    const provider = providerFromRequest(req, env);
    return db.select({ id: x402Authorities.id, mandate_id: x402Authorities.mandateId, worker_id: x402Authorities.workerId,
      payer: x402Authorities.payerAddress, merchant: x402Authorities.merchant, status: x402Authorities.status,
      expires: x402Authorities.expiresAt }).from(x402Authorities).where(eq(x402Authorities.providerId, provider)).limit(100);
  });
  app.post('/internal/x402/prepare', async req => payments.authorities.prepare(providerFromRequest(req, env), req.body));
  app.post('/internal/x402/authorize', async req => {
    const body = z.object({ authority_id: z.string().uuid(), signature: z.string().regex(/^0x[\da-f]{130}$/i) }).parse(req.body);
    return payments.authorities.authorize(providerFromRequest(req, env), body.authority_id, body.signature as Hex);
  });
  app.post('/internal/x402/revoke', async req => {
    const body = z.object({ authority_id: z.string().uuid() }).parse(req.body);
    return payments.authorities.revoke(providerFromRequest(req, env), body.authority_id);
  });
  app.get('/internal/x402/payments', async req => {
    const provider = providerFromRequest(req, env);
    const rows = await db.select({ id: x402Jobs.id }).from(x402Jobs).innerJoin(x402Authorities,
      eq(x402Jobs.authorityId, x402Authorities.id)).where(eq(x402Authorities.providerId, provider))
      .orderBy(desc(x402Jobs.nextAttemptAt), desc(x402Jobs.id)).limit(50);
    return Promise.all(rows.map(row => payments.view(row.id)));
  });
  app.get('/internal/x402/payments/:id', async req => {
    const jobId = id((req.params as { id: string }).id); await owned(req, jobId); return payments.view(jobId);
  });
  app.post('/internal/x402/payments/:id/reconcile', async req => {
    const jobId = id((req.params as { id: string }).id); await owned(req, jobId);
    await payments.process(jobId); return payments.view(jobId);
  });
  app.post('/internal/x402/payments/:id/recovery-draft', async req => {
    const jobId = id((req.params as { id: string }).id); await owned(req, jobId); return payments.recoveryDraft(jobId);
  });
  app.post('/internal/workers/:worker/x402/:id', async req => {
    const params = req.params as { worker: string; id: string };
    const job = await payments.store.get(id(params.id));
    if (!job || job.data.authority.worker_id !== params.worker) throw new ApiError(404, 'NOT_FOUND', 'Payment not found');
    await payments.process(job.id); return payments.view(job.id);
  });
}
