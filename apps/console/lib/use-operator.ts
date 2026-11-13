'use client';

import { useAccountWallet } from '../components/wallet/AccountWallet';
import { useEffect, useState } from 'react';
import { entitlementsApi, type MumbaiStatus } from './entitlements-client';

export type Operator = {
  email: string | null;
  emailVerified: boolean;
  walletAddress: string | null;
  mock: boolean;
  holder: string;
  status: MumbaiStatus | null;
  loading: boolean;
};

/** Verified email and signed wallet for human-friendly defaults. */
export function useOperator(): Operator {
  const account = useAccountWallet();
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void entitlementsApi.status().then(value => { if (!cancelled) setStatus(value); }).catch(() => undefined)
      .finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { email: account.profile?.email ?? null, emailVerified: Boolean(account.profile?.email_verified),
    walletAddress: account.profile?.wallet_address ?? null, mock: Boolean(account.profile?.mock),
    holder: account.profile?.holder ?? '', status, loading: !account.loaded || statusLoading };

}

/**
 * Keep in sync with packages/entitlements/src/features.ts (canonical catalog).
 * Console does not import that package (avoids pulling Registry into the browser bundle).
 */
export const FEATURE_OPTIONS = [
  {
    id: 'ocr',
    label: 'OCR',
    blurb: 'Metered OCR-style paid_run — 1 credit per call',
  },
  {
    id: 'research_fetch',
    label: 'Research fetch',
    blurb: 'Metered URL fetch via bagseven_fetch',
  },
] as const;

/** Access / billing period — grant stays on Registry until paid_through, then evaporates. */
export const TTL_PRESETS = [
  { seconds: 900, label: '15 minutes (demo)' },
  { seconds: 3600, label: '1 hour (demo)' },
  { seconds: 86400, label: '1 day' },
  { seconds: 604800, label: '1 week' },
  { seconds: 2592000, label: '30 days (subscription)' },
] as const;

export function shortId(id: string): string {
  if (!id) return '';
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

export function featureLabel(feature: string): string {
  return FEATURE_OPTIONS.find((f) => f.id === feature)?.label ?? feature;
}
