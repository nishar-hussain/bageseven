import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

function registryPath(): string {
  const base = process.env.BAGSEVEN_DATA_DIR?.trim() || join(process.cwd(), '.data');
  return join(base, 'features.json');
}

function loadCustom(): FeatureRecord[] {
  const path = registryPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { features?: FeatureRecord[] };
    return Array.isArray(raw.features)
      ? raw.features
          .filter((f) => f?.id && !f.builtin)
          .map((f) => ({
            ...f,
            value_type: f.value_type === 'boolean' ? 'boolean' : 'numeric',
          }))
      : [];
  } catch {
    return [];
  }
}

function saveCustom(features: FeatureRecord[]): void {
  const path = registryPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ features }, null, 2), 'utf8');
}

export function listFeatures(): FeatureRecord[] {
  const builtin: FeatureRecord[] = FEATURE_CATALOG.map((f) => ({
    id: f.id,
    label: f.label,
    blurb: f.blurb,
    value_type: f.value_type,
    actions: [...f.actions],
    builtin: true,
    created_at: '1970-01-01T00:00:00.000Z',
  }));
  const custom = loadCustom();
  const seen = new Set(builtin.map((f) => f.id));
  const merged = [...builtin];
  for (const f of custom) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    merged.push({ ...f, builtin: false });
  }
  return merged;
}

export function getFeatureValueType(id: string): FeatureValueType {
  const key = id.trim().toLowerCase();
  return listFeatures().find((f) => f.id === key)?.value_type ?? 'numeric';
}

export function createFeature(input: {
  id: string;
  label?: string;
  blurb?: string;
  value_type?: FeatureValueType;
  actions?: string[];
}): FeatureRecord {
  const id = assertValidFeatureId(input.id);
  const existing = listFeatures();
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
  const custom = loadCustom();
  custom.push(record);
  saveCustom(custom);
  return record;
}
