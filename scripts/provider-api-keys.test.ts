import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb, ProviderApiKeys } from '@bagseven/db';
import { authenticateApiRequest, issueEmbedToken } from '../services/daemon/src/api-keys.js';
const url = process.env.BILLING_TEST_DATABASE_URL;
describe.skipIf(!url)('provider API key lifecycle (isolated PostgreSQL schema)', () => {
  const schema = 'keys_test_' + randomUUID().replaceAll('-', '');
  let admin: ReturnType<typeof createDb>, db: ReturnType<typeof createDb>, keys: ProviderApiKeys;
  beforeAll(async () => {
    admin = createDb({ connectionString: url! }); await admin.$client.query('create schema ' + schema);
    const isolated = new URL(url!); isolated.searchParams.set('options', '-c search_path=' + schema);
    db = createDb({ connectionString: isolated.href });
    await db.$client.query(await readFile(new URL('../packages/db/drizzle/0024_provider_api_keys.sql', import.meta.url), 'utf8'));
    keys = new ProviderApiKeys(db);
  });
  afterAll(async () => { await db?.$client.end(); if (admin) { await admin.$client.query('drop schema if exists ' + schema + ' cascade'); await admin.$client.end(); } });
  it('shows a secret only at creation, stores its hash and enforces expiry and owner-only revocation', async () => {
    const created = await keys.create('provider-a', 'Backend', 'sk');
    expect(created.key).toMatch(/^bgs_sk_/);
    const listed = await keys.list('provider-a');
    expect(JSON.stringify(listed)).not.toContain(created.key);
    expect(listed[0].public_key).toBeNull();
    expect(JSON.stringify((await db.$client.query('select * from provider_api_keys')).rows)).not.toContain(created.key);
    expect((await keys.authenticate(created.key))?.provider_id).toBe('provider-a');
    expect((await keys.list('provider-a'))[0].last_used_at).toBeTruthy();
    expect(await keys.revoke('provider-b', created.record.id)).toBe(false);
    expect(await keys.authenticate(created.key)).not.toBeNull();
    await db.$client.query("update provider_api_keys set expires_at=now()-interval '1 second' where id=$1", [created.record.id]);
    expect(await keys.authenticate(created.key)).toBeNull();
    expect(await keys.list('provider-b')).toEqual([]);
  });
  it('allows overlapping rotation and invalidates customer tokens when their issuing key is revoked', async () => {
    const old = await keys.create('provider-b', 'Old backend', 'sk'), replacement = await keys.create('provider-b', 'New backend', 'sk');
    const env = { BAGSEVEN_SECRET_KEY: 'test-signing-key-that-is-never-shown' };
    const req = (token: string) => ({ headers: { authorization: 'Bearer ' + token } });
    const authority = await authenticateApiRequest(req(old.key), db, env);
    const token = issueEmbedToken('customer', env, 900, 'customer@example.com', authority);
    expect(await authenticateApiRequest(req(token), db, env)).toMatchObject({ provider: 'provider-b', keyId: old.record.id });
    expect(await keys.revoke('provider-b', old.record.id)).toBe(true);
    expect(await keys.revoke('provider-b', old.record.id)).toBe(true);
    await expect(authenticateApiRequest(req(old.key), db, env)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateApiRequest(req(token), db, env)).rejects.toMatchObject({ status: 401 });
    expect(await authenticateApiRequest(req(replacement.key), db, env)).toMatchObject({ provider: 'provider-b' });
  });
  it('retains only public credentials for copy and bounds simultaneous key creation', async () => {
    const publicKey = await keys.create('provider-c', 'Browser', 'pk');
    expect((await keys.list('provider-c'))[0].public_key).toBe(publicKey.key);
    expect((await keys.authenticate(publicKey.key))?.kind).toBe('pk');
    const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => keys.create('quota-provider', 'Key ' + i, 'sk')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(5);
  });
});
