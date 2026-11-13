import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from './client.js';

export type ProviderApiKey = { id: string; provider_id: string; name: string; kind: 'sk' | 'pk'; hint: string;
  public_key: string | null; created_at: Date; expires_at: Date; last_used_at: Date | null; revoked_at: Date | null };
const columns = 'id,provider_id,name,kind,hint,public_key,created_at,expires_at,last_used_at,revoked_at';
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
export function newProviderApiKey(kind: 'sk' | 'pk') {
  const id = randomUUID(), key = `bgs_${kind}_${id.replaceAll('-', '')}_${randomBytes(32).toString('base64url')}`;
  return { id, key, digest: hash(key), hint: key.slice(0, 15) + '…' + key.slice(-4) };
}
export class ProviderApiKeys {
  constructor(private db: Database) {}
  async list(provider: string): Promise<ProviderApiKey[]> {
    return (await this.db.$client.query(`select ${columns} from provider_api_keys where provider_id=$1 order by (revoked_at is null and expires_at>now()) desc,created_at desc,id limit 100`, [provider])).rows;
  }
  async create(provider: string, name: string, kind: 'sk' | 'pk', days = 90) {
    if (!provider || !name.trim() || name.trim().length > 80 || !['sk','pk'].includes(kind) || !Number.isInteger(days) || days < 1 || days > 365) throw Error('INVALID_API_KEY_INPUT');
    const generated = newProviderApiKey(kind), client = await this.db.$client.connect();
    try {
      await client.query('BEGIN');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['api-keys:' + provider]);
      const count = await client.query('select count(*)::int as count from provider_api_keys where provider_id=$1 and revoked_at is null and expires_at>now()', [provider]);
      if (count.rows[0].count >= 10) throw Error('API_KEY_LIMIT: revoke an unused key before creating another');
      const recent = await client.query("select count(*)::int as count from provider_api_keys where provider_id=$1 and created_at>now()-interval '1 hour'", [provider]);
      if (recent.rows[0].count >= 30) throw Error('API_KEY_RATE_LIMIT');
      const row = await client.query(`insert into provider_api_keys(id,provider_id,name,kind,key_hash,hint,public_key,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,now()+$8*interval '1 day') returning ${columns}`,
        [generated.id, provider, name.trim(), kind, generated.digest, generated.hint, kind === 'pk' ? generated.key : null, days]);
      await client.query('COMMIT');
      return { key: generated.key, record: row.rows[0] as ProviderApiKey };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async revoke(provider: string, id: string): Promise<boolean> {
    const result = await this.db.$client.query('update provider_api_keys set revoked_at=coalesce(revoked_at,now()) where provider_id=$1 and id=$2::uuid returning id', [provider, id]);
    return result.rows.length === 1;
  }
  async authenticate(key: string): Promise<ProviderApiKey | null> {
    if (!/^bgs_(sk|pk)_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(key)) return null;
    const result = await this.db.$client.query(`select ${columns} from provider_api_keys where key_hash=$1 and revoked_at is null and expires_at>now()`, [hash(key)]);
    const record = result.rows[0] as ProviderApiKey | undefined;
    if (record && (!record.last_used_at || record.last_used_at.getTime() < Date.now() - 60000))
      await this.db.$client.query("update provider_api_keys set last_used_at=now() where id=$1 and (last_used_at is null or last_used_at<now()-interval '1 minute')", [record.id]);
    return record ?? null;
  }
  async active(id: string, provider: string): Promise<boolean> {
    return (await this.db.$client.query('select id from provider_api_keys where id=$1::uuid and provider_id=$2 and kind=\'sk\' and revoked_at is null and expires_at>now()', [id, provider])).rows.length === 1;
  }
}
