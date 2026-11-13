import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@bagseven/db';
import { AvalancheGrantStore } from './avalanche-store.js';
import { GrantSchema } from './types.js';
import { createHmac } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';

const rpc = vi.hoisted(() => ({ readContract: vi.fn(), getChainId: vi.fn() }));
vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(), createPublicClient: () => rpc }));
const secret = 'test-subject-secret';
const registry = '0x3333333333333333333333333333333333333333';
const holder = 'customer@example.com';
const hash = (value: string) => keccak256(stringToHex(value));

function fixture(count = 20) {
  const now = new Date().toISOString();
  const grants = Array.from({ length: count }, (_, i) => GrantSchema.parse({ id: `grant-${i}`, holder, feature: 'ocr', worker_id: 'worker-one',
    enabled: true, remaining: '3', renewal_enabled: true, paid_through: new Date(Date.now() + 3600000).toISOString(),
    schema_version: 1, created_at: now, updated_at: now }));
  const records = grants.map(data => ({ data, kind: 'grant' }));
  const dialect = new PgDialect();
  let queryParams: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
      queryParams = dialect.sqlToQuery(condition).params;
      return Promise.resolve(records);
    } }) }),
    query: { entitlementRecords: { findFirst: vi.fn(async ({ where }: { where: Parameters<PgDialect['sqlToQuery']>[0] }) => {
      const key = dialect.sqlToQuery(where).params[0];
      return records.find(row => `43113:${registry}:${hash(row.data.id)}` === key);
    }) } },
  };
  let active = 0, peak = 0;
  rpc.getChainId.mockResolvedValue(43113);
  rpc.readContract.mockImplementation(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return [registry, `0x${createHmac('sha256', secret).update(holder).digest('hex')}`, hash('ocr'), 3n * 10n ** 18n,
      BigInt(Math.floor((Date.now() + 3600000) / 1000)), true, true];
  });
  const store = new AvalancheGrantStore(db as unknown as Database, { AVALANCHE_ENTITLEMENT_REGISTRY: registry,
    ENTITLEMENT_SUBJECT_SECRET: secret, AVALANCHE_CHAIN_ID: '43113' });
  return { store, db, params: () => queryParams, peak: () => peak };
}

describe('Avalanche grant discovery scalability', () => {
  it('pushes holder, feature and worker filters into the database query', async () => {
    const f = fixture(1);
    await f.store.findLive({ holder, feature: 'ocr', worker_id: 'worker-one' });
    expect(f.params()).toEqual(expect.arrayContaining([holder, 'ocr', 'worker-one']));
  });
  it('uses bounded parallel chain reads and does not reload each metadata row', async () => {
    const f = fixture();
    expect(await f.store.findLive({ holder })).toHaveLength(20);
    expect(f.peak()).toBeGreaterThan(1);
    expect(f.peak()).toBeLessThanOrEqual(8);
    expect(f.db.query.entitlementRecords.findFirst).not.toHaveBeenCalled();
  });
});
