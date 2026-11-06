'use client';

import { useEffect, useState } from 'react';
import { entitlementsApi, type MumbaiStatus } from './entitlements-client';

export type Operator = {
  email: string | null;
  emailVerified: boolean;
  worldHumanId: string | null;
  walletAddress: string | null;
  mock: boolean;
  holder: string;
  status: MumbaiStatus | null;
  worldLive: boolean;
  loading: boolean;
};

/** Signed-in World identity (+ optional email / wallet) for human-friendly defaults. */
export function useOperator(): Operator {
  const [email, setEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [worldHumanId, setWorldHumanId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [holder, setHolder] = useState('');
  const [status, setStatus] = useState<MumbaiStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [meRes, st] = await Promise.all([
          fetch('/api/me').then(async (r) =>
            r.ok
              ? ((await r.json()) as {
                  email?: string | null;
                  email_verified?: boolean;
                  world_human_id?: string | null;
                  wallet_address?: string | null;
                  mock?: boolean;
                  holder?: string;
                })
              : null,
          ),
          entitlementsApi.status().catch(() => null),
        ]);
        if (cancelled) return;
        setEmail(meRes?.email ?? null);
        setEmailVerified(Boolean(meRes?.email_verified));
        setWorldHumanId(meRes?.world_human_id ?? null);
        setWalletAddress(meRes?.wallet_address ?? null);
        setMock(Boolean(meRes?.mock));
        setHolder(meRes?.holder ?? meRes?.email ?? '');
        setStatus(st);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    email,
    emailVerified,
    worldHumanId,
    walletAddress,
    mock,
    holder,
    status,
    worldLive: Boolean(
      status?.tracks.world.mode === 'idkit' ||
        status?.tracks.world.mode === 'dual' ||
        status?.tracks.world.mode === 'live' ||
        (status?.tracks.world.mode === 'agent_pass' && !status.tracks.world.mock_proofs),
    ),
    loading,
  };
}

/**
 * Keep in sync with packages/entitlements/src/features.ts (canonical catalog).
 * Console does not import that package (avoids pulling Arkiv into the browser bundle).
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

/** Access / billing period — grant stays on Arkiv until paid_through, then evaporates. */
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
