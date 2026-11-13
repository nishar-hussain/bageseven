/** Explicit one-time import of existing feature semantics. Never guesses a storage fallback. */
import { readFileSync } from 'node:fs';
import { createDb, featureDefinitions } from '@bagseven/db';
import { FEATURE_ID_RE } from '@bagseven/entitlements';
import { createRequire } from 'node:module';
const { eq } = createRequire(new URL('../packages/db/package.json', import.meta.url))('drizzle-orm');
const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) throw Error('Usage: node --env-file=.env scripts/import-feature-catalog.mjs <features.json>');
const records = JSON.parse(readFileSync(file, 'utf8')).features;
if (!Array.isArray(records)) throw Error('Invalid feature catalog');
const db = createDb({ connectionString: process.env.DATABASE_URL });
try {
  await db.transaction(async tx => {
    for (const record of records) {
      if (record.builtin) continue;
      if (!FEATURE_ID_RE.test(record.id) || !['boolean', 'numeric'].includes(record.value_type)) throw Error('Invalid feature definition');
      await tx.insert(featureDefinitions).values({ id: record.id, data: record }).onConflictDoNothing();
      const [stored] = await tx.select().from(featureDefinitions).where(eq(featureDefinitions.id, record.id));
      if (stored.data.value_type !== record.value_type) throw Error(`FEATURE_SEMANTICS_CONFLICT: ${record.id}`);
    }
  });
  console.log('Imported feature definitions without changing existing value types.');
} finally { await db.$client.end(); }
