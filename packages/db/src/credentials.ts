import { createHash } from 'node:crypto';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { authCredentials } from './schema/index.js';
export type ExpiringCredential = { exp: number };

/** Raw bearer/code values never enter PostgreSQL. Exchange is single-use across replicas. */
export class CredentialStore<T extends ExpiringCredential> {
  constructor(private db: Database, private namespace: string) {}
  private key(value: string) { return createHash('sha256').update(`${this.namespace}:${value}`).digest('hex'); }
  private live(key: string) { return and(eq(authCredentials.key, this.key(key)), gt(authCredentials.expiresAt, new Date())); }
  async get(key: string): Promise<T | undefined> {
    const [row] = await this.db.select().from(authCredentials).where(this.live(key));
    return row?.data as T | undefined;
  }
  async set(key: string, data: T) {
    await this.db.insert(authCredentials).values({ key: this.key(key), data, expiresAt: new Date(data.exp) })
      .onConflictDoUpdate({ target: authCredentials.key, set: { data, expiresAt: new Date(data.exp) } });
  }
  async claim(key: string, data: T): Promise<boolean> {
    const rows = await this.db.insert(authCredentials).values({ key: this.key(key), data, expiresAt: new Date(data.exp) })
      .onConflictDoUpdate({ target: authCredentials.key, set: { data, expiresAt: new Date(data.exp) },
        setWhere: lte(authCredentials.expiresAt, new Date()) }).returning();
    return rows.length === 1;
  }
  async take(key: string): Promise<T | undefined> {
    const [row] = await this.db.delete(authCredentials).where(this.live(key)).returning();
    return row?.data as T | undefined;
  }
  async exchange(key: string, replacements: Array<{ key: string; data: T }>): Promise<boolean> {
    return this.db.transaction(async tx => {
      const removed = await tx.delete(authCredentials).where(this.live(key)).returning();
      if (!removed.length) return false;
      if (replacements.length) await tx.insert(authCredentials).values(replacements.map(r => ({
        key: this.key(r.key), data: r.data, expiresAt: new Date(r.data.exp),
      })));
      return true;
    });
  }
  async attempt(key: string, max: number): Promise<T | undefined> {
    const [row] = await this.db.update(authCredentials).set({
      data: sql`jsonb_set(${authCredentials.data}, '{attempts}', to_jsonb(coalesce((${authCredentials.data}->>'attempts')::int, 0) + 1))`,
    }).where(and(this.live(key), sql`coalesce((${authCredentials.data}->>'attempts')::int, 0) < ${max}`)).returning();
    return row?.data as T | undefined;
  }
  async prune() {
    await this.db.execute(sql`delete from ${authCredentials} where key in (select key from ${authCredentials} where expires_at <= now() limit 100)`);
  }
}
