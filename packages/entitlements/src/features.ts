/**
 * Built-in feature catalog (Schematic-style defaults).
 * Operators can also create custom feature SKUs — any valid feature id is entitlements-ready.
 * Feature = gated capability. Entitlement = living grant (credits + TTL).
 */
/** ArcenPay / Schematic-style: boolean = on/off access; numeric = metered credits. */
export type FeatureValueType = 'boolean' | 'numeric';

export const FEATURE_CATALOG = [
  {
    id: 'ocr',
    label: 'OCR',
    blurb: 'Metered OCR-style paid_run',
    value_type: 'numeric' as const,
    actions: ['paid_run'] as const,
  },
  {
    id: 'research_fetch',
    label: 'Research fetch',
    blurb: 'Metered URL fetch via bagseven_fetch',
    value_type: 'numeric' as const,
    actions: ['bagseven_fetch', 'paid_run'] as const,
  },
] as const;

export type BuiltinFeatureId = (typeof FEATURE_CATALOG)[number]['id'];
/** Any entitlements feature key — built-in or operator-created. */
export type FeatureId = string;

const BUILTIN = new Set<string>(FEATURE_CATALOG.map((f) => f.id));

/** UI / mint default only — never force this as the dual-gate for every action. */
export const DEFAULT_FEATURE_ID: FeatureId = 'ocr';

/** Feature consumed by daemon `bagseven_fetch` / worker fetch. */
export const FETCH_FEATURE_ID: FeatureId = 'research_fetch';

/** Schematic-style slug: lowercase letter, then letters/digits/underscore, 2–64 chars. */
export const FEATURE_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;

export function isBuiltinFeature(id: string): id is BuiltinFeatureId {
  return BUILTIN.has(id.trim());
}

export function isValidFeatureId(id: string): boolean {
  return FEATURE_ID_RE.test(id.trim().toLowerCase());
}

/** @deprecated Prefer isValidFeatureId — custom features are allowed. */
export function isKnownFeature(id: string): boolean {
  return isValidFeatureId(id);
}

export function assertValidFeatureId(id: string): FeatureId {
  const key = id.trim().toLowerCase();
  if (!FEATURE_ID_RE.test(key)) {
    throw new Error(
      `INVALID_FEATURE: "${id}" — use a slug like api_access or team_seat (lowercase, 2–64 chars)`,
    );
  }
  return key;
}

/** Accepts built-in or custom feature slugs. */
export function assertKnownFeature(id: string): FeatureId {
  return assertValidFeatureId(id);
}

export function featureLabel(id: string, extras?: Array<{ id: string; label: string }>): string {
  const key = id.trim();
  const builtin = FEATURE_CATALOG.find((f) => f.id === key);
  if (builtin) return builtin.label;
  const extra = extras?.find((f) => f.id === key);
  return extra?.label ?? key;
}

/**
 * Resolve which feature an action meters.
 * - Explicit preferred (if valid) wins
 * - fetch → research_fetch
 * - paid_run with no preference → any living grant (caller should omit feature filter)
 */
export function featureForAction(
  action: 'fetch' | 'paid_run',
  preferred?: string | null,
): FeatureId | undefined {
  const p = preferred?.trim().toLowerCase();
  if (p && isValidFeatureId(p)) return p;
  if (action === 'fetch') return FETCH_FEATURE_ID;
  return undefined;
}
