import { add } from '@bagseven/money';
import type { FeatureDef, Grant } from './entitlements-client';

/** Credits of different features are different units; boolean access is not a credit. */
export function summarizeAccess(
  grants: Pick<Grant, 'feature' | 'remaining'>[],
  features: Pick<FeatureDef, 'id' | 'label' | 'value_type'>[],
) {
  const rows = new Map<string, { label: string; units: string; count: number; type: string }>();
  for (const grant of grants) {
    const feature = features.find((f) => f.id === grant.feature);
    const row = rows.get(grant.feature) ?? {
      label: feature?.label ?? grant.feature,
      units: '0',
      count: 0,
      type: feature?.value_type ?? 'unknown',
    };
    if (row.type === 'numeric') row.units = add(row.units, grant.remaining);
    row.count += 1;
    rows.set(grant.feature, row);
  }
  return [...rows.entries()];
}
