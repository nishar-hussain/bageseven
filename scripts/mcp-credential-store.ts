import { CredentialStore, createDb, type ExpiringCredential } from '@bagseven/db';
let database: ReturnType<typeof createDb> | undefined;
/** In-memory implementation is selected only by the test runner. */
class TestCredentials<T extends ExpiringCredential> {
  private rows = new Map<string, T>();
  async get(k: string) { const v = this.rows.get(k); return v && v.exp > Date.now() ? structuredClone(v) : undefined; }
  async set(k: string, v: T) { this.rows.set(k, structuredClone(v)); }
  async claim(k: string, v: T) { const old = this.rows.get(k); if (old && old.exp > Date.now()) return false; this.rows.set(k, structuredClone(v)); return true; }
  async take(k: string) { const v = this.rows.get(k); this.rows.delete(k); return v && v.exp > Date.now() ? structuredClone(v) : undefined; }
  async exchange(k: string, replacements: Array<{ key: string; data: T }>) {
    if (!await this.take(k)) return false;
    for (const r of replacements) await this.set(r.key, r.data);
    return true;
  }
  async attempt(k: string, max: number) {
    const row = this.rows.get(k) as (T & { attempts?: number }) | undefined;
    if (!row || row.exp <= Date.now() || (row.attempts ?? 0) >= max) return undefined;
    row.attempts = (row.attempts ?? 0) + 1; return structuredClone(row);
  }
  async prune() { for (const [k, v] of this.rows) if (v.exp <= Date.now()) this.rows.delete(k); }
}
export function mcpCredentials<T extends ExpiringCredential>(namespace: string) {
  if (process.env.NODE_ENV === 'test') return new TestCredentials<T>();
  if (!process.env.DATABASE_URL) throw Error('MCP_AUTH_STORAGE_UNAVAILABLE: DATABASE_URL is required');
  database ??= createDb({ connectionString: process.env.DATABASE_URL, max: 5 });
  return new CredentialStore<T>(database, namespace);
}
