'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IDKitRequestWidget, proofOfHuman, type RpContext } from '@worldcoin/idkit';

type WorldStatus = {
  mock_proofs: boolean;
  idkit: boolean;
  signing_configured?: boolean;
  app_id: string;
  rp_id: string;
  action: string;
  login_action?: string;
  login_signal?: string;
  environment: 'production' | 'staging' | 'sandbox';
};

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get('next') || '/app';
  const err = params.get('error');
  const [msg, setMsg] = useState(
    err === 'expired'
      ? 'That recovery link expired. Sign in with World again.'
      : err === 'misconfigured'
        ? 'Auth is misconfigured on the server (AUTH_SECRET).'
        : '',
  );
  const [busy, setBusy] = useState(false);
  const [idkitOpen, setIdkitOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [challengeNonce, setChallengeNonce] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [status, setStatus] = useState<WorldStatus | null>(null);

  useEffect(() => {
    void fetch('/api/auth/world', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('World configuration unavailable');
        return res.json();
      })
      .then(setStatus)
      .catch(() => setMsg('World sign-in is temporarily unavailable. Please try again.'));
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
          credentials: 'same-origin',
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          note?: string;
          returning?: boolean;
          needs_onboarding?: boolean;
        };
        if (!res.ok) {
          setMsg(json.error ?? 'World sign-in failed');
          return false;
        }
        if (json.returning) setMsg('Welcome back — signing you in…');
        else if (json.note) setMsg(json.note);
        const dest = json.needs_onboarding
          ? `/app/onboarding?next=${encodeURIComponent(next.startsWith('/') && !next.startsWith('//') ? next : '/app')}`
          : next.startsWith('/') && !next.startsWith('//')
            ? next
            : '/app';
        router.replace(dest);
        return true;
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [next, router],
  );

  const beginIdKit = async () => {
    setBusy(true);
    setMsg('Opening World ID…');
    // Drop any prior context so the widget remounts with a fresh RP signature.
    setIdkitOpen(false);
    setRpContext(null);
    setChallengeNonce(null);
    try {
      const response = await fetch('/api/auth/world/challenge', { method: 'POST', credentials: 'same-origin' });
      const sig = await response.json();
      if (!response.ok) throw new Error(sig.error?.message || 'Could not start World verification');
      if (!sig.nonce || !sig.sig || !sig.rp_id) throw new Error('World challenge response incomplete');
      setChallengeNonce(sig.nonce as string);
      setRpContext({
        rp_id: sig.rp_id as `rp_${string}`,
        nonce: sig.nonce,
        created_at: sig.created_at,
        expires_at: sig.expires_at,
        signature: sig.sig,
      });
      setIdkitOpen(true);
      setMsg('Scan with World App to continue.');
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

  const idkitReady = Boolean(status?.app_id && status.rp_id && status.idkit);
  const loginAction = status?.login_action || 'bagseven-login';
  const loginSignal = status?.login_signal || 'bagseven-login';
  // Same preset style as mint — uniqueness Proof of Human with legacy proofs allowed.
  const preset = useMemo(() => proofOfHuman({ signal: loginSignal }), [loginSignal]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f2f2] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-xl font-semibold text-[#0002f8]">Bagseven</span>
        </div>
        <div className="rounded-[16px] border border-[#ececf0] bg-white p-8 shadow-[0_1px_2px_#0e0e100d,0_18px_40px_-18px_#0e0e102e]">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in with World</h1>
          <p className="mt-2 text-sm text-[#63636d]">
            Verify once with World ID. New accounts can add email and a payout wallet next — both optional.
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
            ) : (
              <p className="text-sm text-[#63636d]">
                World ID sign-in is awaiting server configuration (app_id, rp_id, RP signing key). Contact the
                operator.
              </p>
            )}
          </div>

          {msg && <p className="mt-4 whitespace-pre-wrap text-sm text-[#63636d]">{msg}</p>}

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
        <p className="mt-6 text-center text-xs text-[#6f6f78]">
          Uses World action <span className="font-mono">{loginAction}</span>. Create that action in the Developer Portal
          if it does not exist yet.
        </p>
      </div>

      {/*
        Do NOT pass session_id="create" together with allow_legacy_proofs — IDKit requires
        allow_legacy_proofs: false for session creation and otherwise returns generic_error.
        Login matches the working mint uniqueness flow; backend accepts nullifier_replayed
        as a returning-user sign-in.
      */}
      {idkitReady && rpContext ? (
        <IDKitRequestWidget
          key={challengeNonce ?? 'idle'}
          open={idkitOpen}
          onOpenChange={setIdkitOpen}
          app_id={status!.app_id as `app_${string}`}
          action={loginAction}
          rp_context={rpContext}
          allow_legacy_proofs={true}
          environment={status!.environment === 'sandbox' ? 'staging' : status!.environment}
          preset={preset}
          handleVerify={async (result) => {
            const ok = await finish({
              idkit_response: result,
              challenge_nonce: challengeNonce ?? undefined,
            });
            if (!ok) throw new Error('World sign-in verification failed');
          }}
          onSuccess={() => setIdkitOpen(false)}
          onError={(code, debugReport) => {
            setIdkitOpen(false);
            const c = String(code);
            const detail =
              debugReport && typeof debugReport === 'object'
                ? JSON.stringify(debugReport).slice(0, 280)
                : '';
            if (c === 'nullifier_replayed' || c === 'max_verifications_reached') {
              setMsg(
                'This World ID already used the login action. Tap Continue again — a fresh challenge will sign you in as a returning user once the proof reaches the server.',
              );
              return;
            }
            if (c === 'invalid_rp_signature' || c === 'unknown_rp' || c === 'inactive_rp') {
              setMsg(
                `World RP config error (${c}). Confirm WORLD_RP_ID / WORLD_RP_SIGNING_KEY / WORLD_SIGNER_ADDRESS match the Developer Portal.`,
              );
              return;
            }
            if (c === 'malformed_request' || c === 'generic_error') {
              setMsg(
                `World ID request failed (${c}). Ensure action "${loginAction}" exists on your app in the Developer Portal, then request a fresh challenge.${detail ? `\n${detail}` : ''}`,
              );
              return;
            }
            setMsg(`World ID failed (${c}). Try again — request a fresh challenge.${detail ? `\n${detail}` : ''}`);
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
