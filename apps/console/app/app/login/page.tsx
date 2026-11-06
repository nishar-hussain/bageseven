'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { worldLoginError } from '../../../lib/world-login-errors';
import { IDKitSessionWidget, CredentialRequest, type RpContext } from '@worldcoin/idkit';

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
  device_resume?: boolean;
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
  const verificationError = useRef<string | null>(null);
  const verificationAttempted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [idkitOpen, setIdkitOpen] = useState(false);
  const [existingSessionId, setExistingSessionId] = useState<`session_${string}` | undefined>();
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [challengeNonce, setChallengeNonce] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [status, setStatus] = useState<WorldStatus | null>(null);
  const finishing = useRef(false);

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
      if (finishing.current) return false;
      finishing.current = true;
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
          verificationError.current = typeof json.error === 'string' ? json.error : 'World sign-in failed';
          setMsg(verificationError.current);
          return false;
        }
        setMsg(json.returning ? 'Welcome back…' : 'Signed in…');
        const dest = json.needs_onboarding
          ? `/app/onboarding?next=${encodeURIComponent(next.startsWith('/') && !next.startsWith('//') ? next : '/app')}`
          : next.startsWith('/') && !next.startsWith('//')
            ? next
            : '/app';
        router.replace(dest);
        return true;
      } catch (e) {
        verificationError.current = e instanceof Error ? e.message : String(e);
        setMsg(verificationError.current);
        return false;
      } finally {
        finishing.current = false;
        setBusy(false);
      }
    },
    [next, router],
  );

  const beginIdKit = async () => {
    setBusy(true);
    verificationError.current = null;
    verificationAttempted.current = false;
    setMsg('Opening World ID…');
    setIdkitOpen(false);
    setRpContext(null);
    setChallengeNonce(null);
    try {
      const response = await fetch('/api/auth/world/challenge', { method: 'POST', credentials: 'same-origin' });
      const sig = await response.json();
      if (!response.ok) throw new Error(sig.error?.message || 'Could not start World verification');
      if (!sig.nonce || !sig.sig || !sig.rp_id) throw new Error('World challenge response incomplete');
      setExistingSessionId(sig.existing_session_id);
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
  const constraints = useMemo(() => CredentialRequest('proof_of_human'), []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f2f2] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <span className="text-xl font-semibold text-[#0002f8]">Bagseven</span>
        </div>
        <div className="rounded-[16px] border border-[#ececf0] bg-white p-8 shadow-[0_1px_2px_#0e0e100d,0_18px_40px_-18px_#0e0e102e]">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[#63636d]">Continue with World ID.</p>

          <div className="mt-6 space-y-3">
            {status?.device_resume ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish({ device_resume: true })}
                className="w-full rounded-full bg-[#0e0e10] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Continue on this device'}
              </button>
            ) : null}
            {idkitReady ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void beginIdKit()}
                className={`w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-60 ${
                  status?.device_resume
                    ? 'border border-[#ececf0] bg-white text-[#0e0e10]'
                    : 'bg-[#0e0e10] text-white'
                }`}
              >
                {busy ? 'Working…' : status?.device_resume ? 'Verify with World ID again' : 'Continue with World ID'}
              </button>
            ) : !status?.device_resume ? (
              <p className="text-sm text-[#63636d]">World ID is not configured on this server yet.</p>
            ) : null}
          </div>

          {msg ? <p className="mt-4 whitespace-pre-wrap text-sm text-[#63636d]">{msg}</p> : null}

          <button
            type="button"
            className="mt-6 text-xs font-medium text-[#0002f8]"
            onClick={() => setShowRecovery((v) => !v)}
          >
            {showRecovery ? 'Hide recovery' : 'Email recovery'}
          </button>
          {showRecovery ? (
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
                Email me a link
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {idkitReady && rpContext ? (
        <IDKitSessionWidget
          key={challengeNonce ?? 'idle'}
          open={idkitOpen}
          onOpenChange={setIdkitOpen}
          app_id={status!.app_id as `app_${string}`}
          rp_context={rpContext}
          environment={status!.environment}
          constraints={constraints}
          existing_session_id={existingSessionId}
          handleVerify={async (result) => {
            verificationAttempted.current = true;
            const ok = await finish({
              idkit_response: result,
              challenge_nonce: challengeNonce ?? undefined,
              returning_ok: true,
            });
            if (!ok) throw new Error(verificationError.current ?? 'World sign-in verification failed');
          }}
          onSuccess={() => setIdkitOpen(false)}
          onError={(code) => {
            setIdkitOpen(false);
            setMsg(worldLoginError(String(code), verificationError.current));
            void fetch('/api/auth/world/error', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code, stage: verificationAttempted.current ? 'backend' : 'world_app' }),
            }).catch(() => undefined);
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
