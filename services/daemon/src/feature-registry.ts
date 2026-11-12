import { createDb, featureDefinitions, type Database } from '@bagseven/db';
import { eq } from 'drizzle-orm';
import {
  FEATURE_CATALOG,
  assertValidFeatureId,
  featureLabel,
  type FeatureValueType,
} from '@bagseven/entitlements';

export type FeatureRecord = {
  id: string;
  label: string;
  blurb: string;
  value_type: FeatureValueType;
  actions: string[];
  builtin: boolean;
  created_at: string;
};

let database: Database | undefined;
export function configureFeatureDatabase(value: Database) { database = value; }
const testFeatures = new Map<string, FeatureRecord>();
function db() {
  if (!process.env.DATABASE_URL) throw Error('FEATURE_STORAGE_UNAVAILABLE: DATABASE_URL is required');
  return database ??= createDb({ connectionString: process.env.DATABASE_URL, max: 5 });
}
async function loadCustom(): Promise<FeatureRecord[]> {
  if (process.env.NODE_ENV === 'test') return [...testFeatures.values()];
  return (await db().select().from(featureDefinitions)).map(row => row.data as FeatureRecord);
}

export async function listFeatures(): Promise<FeatureRecord[]> {
  const builtin: FeatureRecord[] = FEATURE_CATALOG.map((f) => ({
    id: f.id,
    label: f.label,
    blurb: f.blurb,
    value_type: f.value_type,
    actions: [...f.actions],
    builtin: true,
    created_at: '1970-01-01T00:00:00.000Z',
  }));
  const custom = await loadCustom();
  const seen = new Set(builtin.map((f) => f.id));
  const merged = [...builtin];
  for (const f of custom) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    merged.push({ ...f, builtin: false });
  }
  return merged;
}

export async function getFeatureValueType(id: string): Promise<FeatureValueType> {
  const key = id.trim().toLowerCase();
  const builtin = FEATURE_CATALOG.find(f => f.id === key);
  if (builtin) return builtin.value_type;
  if (process.env.NODE_ENV === 'test') return testFeatures.get(key)?.value_type ?? 'numeric';
  const [row] = await db().select().from(featureDefinitions).where(eq(featureDefinitions.id, key));
  return (row?.data as FeatureRecord | undefined)?.value_type ?? 'numeric';
}

export async function createFeature(input: {
  id: string;
  label?: string;
  blurb?: string;
  value_type?: FeatureValueType;
  actions?: string[];
}): Promise<FeatureRecord> {
  const id = assertValidFeatureId(input.id);
  const existing = await listFeatures();
  if (existing.some((f) => f.id === id)) {
    throw new Error(`FEATURE_EXISTS: ${id}`);
  }
  const value_type: FeatureValueType = input.value_type === 'boolean' ? 'boolean' : 'numeric';
  const record: FeatureRecord = {
    id,
    label: (input.label?.trim() || featureLabel(id)).slice(0, 80),
    blurb:
      (input.blurb?.trim() ||
        (value_type === 'boolean' ? 'Boolean access (on/off until TTL)' : 'Numeric metered credits')).slice(0, 200),
    value_type,
    actions:
      input.actions?.length
        ? input.actions.map((a) => a.trim()).filter(Boolean)
        : value_type === 'boolean'
          ? ['access']
          : ['paid_run'],
    builtin: false,
    created_at: new Date().toISOString(),
  };
  if (process.env.NODE_ENV === 'test') testFeatures.set(id, record);
  else {
    const rows = await db().insert(featureDefinitions).values({ id, data: record }).onConflictDoNothing().returning();
    if (!rows.length) throw Error(`FEATURE_EXISTS: ${id}`);
  }
  return record;
}
