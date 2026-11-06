'use client';

import { useCallback, useEffect, useState } from 'react';
import { entitlementsApi, type FeatureDef } from './entitlements-client';

const FALLBACK: FeatureDef[] = [
  {
    id: 'ocr',
    label: 'OCR',
    blurb: 'Metered OCR-style paid_run',
    value_type: 'numeric',
    actions: ['paid_run'],
    builtin: true,
  },
  {
    id: 'research_fetch',
    label: 'Research fetch',
    blurb: 'Metered URL fetch via bagseven_fetch',
    value_type: 'numeric',
    actions: ['bagseven_fetch', 'paid_run'],
    builtin: true,
  },
];

/** Built-in + operator-created features for mint / plans / entitlements. */
export function useFeatures() {
  const [features, setFeatures] = useState<FeatureDef[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await entitlementsApi.features();
      setFeatures(r.features?.length ? r.features : FALLBACK);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFeatures(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { features, loading, error, refresh };
}

export function featureLabel(id: string, features?: FeatureDef[]): string {
  return features?.find((f) => f.id === id)?.label ?? id;
}
