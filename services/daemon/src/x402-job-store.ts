import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, lte, notInArray, sql } from 'drizzle-orm';
import { x402Authorities, x402Jobs, type Database } from '@bagseven/db';
import { X402AuthorityTerms, type X402Authority, type X402JobData, type X402JobState } from './x402-types.js';
export type X402Job = { id: string; authorityId: string; idempotencyKey: string; fingerprint: string; state: X402JobState; data: X402JobData; lease: number; lastError?: string | null };
const terminal = ['SETTLED', 'REFUNDED', 'REJECTED'];
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
export class X402JobStore {
  private locks = 0;
  constructor(readonly db: Database) {}
  async get(id: string): Promise<X402Job | null> {
    const [row] = await this.db.select().from(x402Jobs).where(eq(x402Jobs.id, id));
    return row ? { ...row, state: row.state as X402JobState, data: row.data as X402JobData } : null;
  }
  async forRequest(worker: string, key: string, url: string) {
    const rows = await this.db.select({ id: x402Jobs.id, data: x402Jobs.data }).from(x402Jobs)
      .innerJoin(x402Authorities, eq(x402Jobs.authorityId, x402Authorities.id))
      .where(and(eq(x402Authorities.workerId, worker), eq(x402Jobs.idempotencyKey, key))).limit(2);
    const [row] = rows;
    if (!row) return null;
    if (rows.length !== 1 || (row.data as X402JobData).url !== new URL(url).toString()) throw Error('IDEMPOTENCY_CONFLICT: resource changed');
    return row.id;
  }
  async start(terms: X402Authority, key: string, data: Omit<X402JobData, 'authority'>) {
    if (!key.trim() || key.length > 200) throw Error('X402_IDEMPOTENCY_KEY_REQUIRED');
    const fingerprint = createHash('sha256').update(JSON.stringify(stable(data))).digest('hex');
    return this.db.transaction(async tx => {
      const [authority] = await tx.select().from(x402Authorities).where(eq(x402Authorities.id, terms.id)).for('update');
      if (!authority) throw Error('X402_AUTHORITY_NOT_FOUND');
      const [prior] = await tx.select().from(x402Jobs).where(and(eq(x402Jobs.authorityId, terms.id), eq(x402Jobs.idempotencyKey, key)));
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('IDEMPOTENCY_CONFLICT: x402 payment inputs changed');
        return prior.id;
      }
      const current = X402AuthorityTerms.parse(authority.authorization);
      if (authority.status !== 'active' || current.expires <= Date.now() || current.nonce !== terms.nonce) throw Error('X402_PROVIDER_APPROVAL_REQUIRED');
      const unresolved = await tx.select({ id: x402Jobs.id }).from(x402Jobs).where(and(eq(x402Jobs.authorityId, terms.id), notInArray(x402Jobs.state, terminal))).limit(1);
      if (unresolved.length) throw Error('X402_PAYER_BUSY: reconcile its existing allocation before another payment');
      const id = randomUUID();
      await tx.insert(x402Jobs).values({ id, authorityId: terms.id, idempotencyKey: key, fingerprint,
        state: 'PREPARED', data: { ...data, authority: terms } });
      return id;
    });
  }
  async save(job: X402Job, state: X402JobState, patch: Partial<X402JobData> = {}, error?: string) {
    const [row] = await this.db.update(x402Jobs).set({ state, data: { ...job.data, ...patch },
      lastError: error ?? null, nextAttemptAt: new Date(Date.now() + (error ? 60000 : 15000)) })
      .where(and(eq(x402Jobs.id, job.id), eq(x402Jobs.state, job.state), eq(x402Jobs.lease, job.lease))).returning();
    if (!row) throw Error('X402_JOB_CHANGED: reload before continuing');
    return { ...row, state: row.state as X402JobState, data: row.data as X402JobData };
  }
  async due(limit = 100) {
    return this.db.select({ id: x402Jobs.id }).from(x402Jobs).where(and(sql`${x402Jobs.state} NOT IN ('SETTLED', 'REFUNDED', 'REJECTED')`, lte(x402Jobs.nextAttemptAt, new Date())))
      .orderBy(asc(x402Jobs.nextAttemptAt), asc(x402Jobs.id)).limit(limit);
  }
  async lock<T>(id: string, operation: () => Promise<T>) {
    if (this.locks >= 2) return undefined;
    this.locks++;
    try {
      return await this.db.transaction(async tx => {
        const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${'x402:' + id}, 0)) as locked`);
        if (!result.rows[0]?.locked) return undefined;
        await this.db.update(x402Jobs).set({ lease: sql`${x402Jobs.lease} + 1` }).where(eq(x402Jobs.id, id));
        return operation(); // Independent journal writes commit before network operations.
      });
    } finally { this.locks--; }
  }
}
