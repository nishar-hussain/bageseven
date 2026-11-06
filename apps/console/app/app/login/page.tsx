'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IDKitRequestWidget, proofOfHuman, type RpContext } from '@worldcoin/idkit';
import { entitlementsApi } from '../../../lib/entitlements-client';

const APP_ID = (process.env.NEXT_PUBLIC_WORLD_APP_ID || '') as `app_${string}`;
const RP_ID = process.env.NEXT_PUBLIC_WORLD_RP_ID || '';
const ACTION = process.env.NEXT_PUBLIC_WORLD_IDKIT_ACTION || 'bagseven-mint';
const ENVIRONMENT = (process.env.NEXT_PUBLIC_WORLD_IDKIT_ENVIRONMENT || 'production') as 'production' | 'staging';

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get('next') || '/app';
  const err = params.get('error');
  const [msg, setMsg] = useState(err === 'expired' ? 'That recovery link expired. Sign in with World again.' : '');
  const [busy, setBusy] = useState(false);
  const [idkitOpen, setIdkitOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [status, setStatus] = useState<{ mock_proofs?: boolean; idkit?: boolean } | null>(null);

  useEffect(() => {
    void entitlementsApi
      .status()
      .then((s) => setStatus({ mock_proofs: s.tracks.world.mock_proofs, idkit: s.tracks.world.idkit }))
      .catch(() => setStatus({ mock_proofs: true, idkit: false }));
  }, []);

  const finish = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setMsg('Signing in…');
      try {
        const res = await fetch('/api/auth/world', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; note?: string };
        if (!res.ok) {
          setMsg(json.error ?? 'World sign-in failed');
          return;
        }
        if (json.note) setMsg(json.note);
        router.replace(next.startsWith('/') ? next : '/app');
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [next, router],
  );

  const mockSignIn = () => void finish({ mock: true });

  const beginIdKit = async () => {
    setBusy(true);
    setMsg('Opening World ID…');
    try {
      const sig = await entitlementsApi.worldRpSignature(ACTION);
      setRpContext({
        rp_id: (sig.rp_id || RP_ID) as `rp_${string}`,
        nonce: sig.nonce,
        created_at: sig.created_at,
        expires_at: sig.expires_at,
        signature: sig.sig,
      });
      setIdkitOpen(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('Sending recovery link…');
    const res = await fetch('/api/auth/magic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: recoveryEmail, next }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error ?? 'Could not send link');
      return;
    }
    setMsg(json.dev_hint ? `Dev: ${json.dev_hint}` : `Check ${recoveryEmail} for a recovery link.`);
  };

  const idkitReady = Boolean(APP_ID && RP_ID);
  const mockAllowed = status?.mock_proofs === true;
  const preset = useMemo(() => proofOfHuman({ signal: 'bagseven-login' }), []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f2f2] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-xl font-semibold text-[#0002f8]">Bagseven</span>
          <span className="rounded-md bg-[#f2f3ff] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#0002f8]">Beta</span>
        </div>
        <div className="rounded-[16px] border border-[#ececf0] bg-white p-8 shadow-[0_1px_2px_#0e0e100d,0_18px_40px_-18px_#0e0e102e]">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in with World</h1>
          <p className="mt-2 text-sm text-[#63636d]">
            World is the primary door. Add and verify an email later from Account for receipts.
          </p>

          <div className="mt-6 space-y-3">
            {idkitReady ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void beginIdKit()}
                className="w-full rounded-full bg-[#0e0e10] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Continue with World ID'}
              </button>
            ) : null}
            {mockAllowed ? (
              <button
                type="button"
                disabled={busy}
                onClick={mockSignIn}
                className="w-full rounded-full border border-[#ececf0] bg-white py-2.5 text-sm font-semibold text-[#0e0e10]"
              >
                Continue with World (mock)
              </button>
            ) : null}
            {!idkitReady && !mockAllowed ? (
              <p className="text-sm text-[#63636d]">Configure World IDKit credentials or enable WORLD_MOCK_PROOFS locally.</p>
            ) : null}
          </div>

          {msg && <p className="mt-4 text-sm text-[#63636d] whitespace-pre-wrap">{msg}</p>}

          <button
            type="button"
            className="mt-6 text-xs font-medium text-[#0002f8]"
            onClick={() => setShowRecovery((v) => !v)}
          >
            {showRecovery ? 'Hide recovery' : 'Email recovery / invite link'}
          </button>
          {showRecovery && (
            <form onSubmit={(e) => void sendRecovery(e)} className="mt-3 space-y-3">
              <input
                type="email"
                required
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-[#ececf0] px-3 py-2.5 text-sm"
              />
              <button type="submit" className="w-full rounded-full border border-[#ececf0] py-2 text-sm font-medium">
                Email me a recovery link
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-[#6f6f78]">A session lasts 8 hours.</p>
      </div>

      {idkitReady && rpContext ? (
        <IDKitRequestWidget
          open={idkitOpen}
          onOpenChange={setIdkitOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs
          environment={ENVIRONMENT}
          preset={preset}
          handleVerify={async (result) => {
            await finish({ idkit_response: result });
          }}
          onSuccess={() => setIdkitOpen(false)}
          onError={(code) => {
            setIdkitOpen(false);
            setMsg(`World ID failed (${String(code)})`);
          }}
        />
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#f2f2f2]">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
