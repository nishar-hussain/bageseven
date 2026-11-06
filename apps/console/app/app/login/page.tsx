'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  device_resume?: boolean;
};

/** Pull the IDKit result out of an onError debug report so returning users can finish sign-in. */
function extractIdkitResult(debugReport: unknown): Record<string, unknown> | null {
  if (!debugReport || typeof debugReport !== 'object') return null;
  const report = debugReport as { response_payload?: unknown; request_payload?: unknown };
  let payload: unknown = report.response_payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const candidates = [obj, obj.result, obj.idkit_response, obj.proof, obj.response];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const row = c as Record<string, unknown>;
    if (Array.isArray(row.responses) && typeof row.nonce === 'string') return row;
  }
  return null;
}

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
          setMsg(json.error ?? 'World sign-in failed');
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
        setMsg(e instanceof Error ? e.message : String(e));
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
    setMsg('Opening World ID…');
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
  const preset = useMemo(() => proofOfHuman({ signal: loginSignal }), [loginSignal]);

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
              returning_ok: true,
            });
            if (!ok) throw new Error('World sign-in verification failed');
          }}
          onSuccess={() => setIdkitOpen(false)}
          onError={(code, debugReport) => {
            setIdkitOpen(false);
            const c = String(code);
            // World uniqueness is one-shot. Returning users hit nullifier_replayed —
            // that means already verified; complete sign-in with the proof if present.
            if (c === 'nullifier_replayed' || c === 'max_verifications_reached') {
              const proof = extractIdkitResult(debugReport);
              if (proof) {
                setMsg('Welcome back — finishing sign-in…');
                void finish({
                  idkit_response: proof,
                  challenge_nonce: challengeNonce ?? (typeof proof.nonce === 'string' ? proof.nonce : undefined),
                  returning_ok: true,
                });
                return;
              }
              // Same browser already verified this World ID once — resume from signed identity cookie.
              setMsg('Welcome back — signing you in…');
              void finish({ device_resume: true }).then((ok) => {
                if (!ok) {
                  setMsg(
                    'This World ID already verified once. Tap Continue again — if it still fails, use Email recovery or clear site cookies and contact support.',
                  );
                }
              });
              return;
            }
            if (c === 'invalid_rp_signature' || c === 'unknown_rp' || c === 'inactive_rp') {
              setMsg(`World RP config error (${c}). Check WORLD_RP_ID / WORLD_RP_SIGNING_KEY.`);
              return;
            }
            if (c === 'user_rejected' || c === 'cancelled') {
              setMsg('Sign-in cancelled.');
              return;
            }
            if (c === 'malformed_request' || c === 'generic_error') {
              setMsg(`World ID failed (${c}). Ensure action "${loginAction}" exists in the Developer Portal.`);
              return;
            }
            setMsg(`World ID failed (${c}). Try again.`);
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
