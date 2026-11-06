/**
 * Canonical feature catalog (Schematic-style).
 * Feature = gated capability. Entitlement = living grant for a feature (credits + TTL).
 * OCR is a demo SKU — not the product.
 */
export const FEATURE_CATALOG = [
  {
    id: 'ocr',
    label: 'OCR',
    blurb: 'Demo metered feature — burn credits on paid_run',
    actions: ['paid_run'] as const,
  },
  {
    id: 'research_fetch',
    label: 'Research fetch',
    blurb: 'Demo metered feature — burn credits on bagseven_fetch / paid URL fetch',
    actions: ['bagseven_fetch', 'paid_run'] as const,
  },
] as const;

export type FeatureId = (typeof FEATURE_CATALOG)[number]['id'];

const IDS = new Set<string>(FEATURE_CATALOG.map((f) => f.id));

/** UI / mint default only — never force this as the dual-gate for every action. */
export const DEFAULT_FEATURE_ID: FeatureId = 'ocr';

/** Feature consumed by daemon `bagseven_fetch` / worker fetch. */
export const FETCH_FEATURE_ID: FeatureId = 'research_fetch';

export function isKnownFeature(id: string): id is FeatureId {
  return IDS.has(id);
}

export function assertKnownFeature(id: string): FeatureId {
  const key = id.trim();
  if (!isKnownFeature(key)) {
    throw new Error(`UNKNOWN_FEATURE: ${key} (known: ${FEATURE_CATALOG.map((f) => f.id).join(', ')})`);
  }
  return key;
}

export function featureLabel(id: string): string {
  return FEATURE_CATALOG.find((f) => f.id === id)?.label ?? id;
}

/**
 * Resolve which feature an action meters.
 * - Explicit preferred (if known) wins
 * - fetch → research_fetch
 * - paid_run with no preference → any living grant (caller should omit feature filter)
 */
export function featureForAction(
  action: 'fetch' | 'paid_run',
  preferred?: string | null,
): FeatureId | undefined {
  const p = preferred?.trim();
  if (p && isKnownFeature(p)) return p;
  if (action === 'fetch') return FETCH_FEATURE_ID;
  return undefined;
}
