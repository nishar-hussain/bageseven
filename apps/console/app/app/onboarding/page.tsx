'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { connectWhitechainWallet } from '@bagseven/sdk/wallet';

type Step = 'email' | 'wallet';

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/app';
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [wallet, setWallet] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    setMsg('Finishing setup…');
    try {
      const res = await fetch('/api/auth/onboarding/complete', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error ?? 'Could not finish onboarding');
        return;
      }
      router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/app');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('Sending code…');
    try {
      const res = await fetch('/api/auth/email/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error ?? 'Could not send code');
        return;
      }
      setChallenge(json.challenge ?? '');
      setMsg(json.dev_hint ? `Dev code: ${json.dev_hint}` : `Code sent to ${email}`);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, challenge }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error ?? 'Invalid code');
        return;
      }
      setMsg(`Email verified: ${json.email}`);
      setStep('wallet');
    } finally {
      setBusy(false);
    }
  };

  const saveWallet = async (address: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet_address: address }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error ?? 'Could not save wallet');
        return;
      }
      setWallet(json.wallet_address);
      setMsg(`Wallet saved: ${json.wallet_address}`);
      await finish();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Welcome</p>
        <h1 className="mt-2 text-[2rem] font-semibold tracking-tight">Finish setting up</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          You are signed in with World. Email and wallet are optional — skip either and add them later from Account.
        </p>
      </div>

      <div className="mb-4 flex gap-2 text-xs font-medium">
        <span className={`rounded-full px-3 py-1 ${step === 'email' ? 'bg-[var(--ink)] text-white' : 'bg-[var(--soft)] text-[var(--muted)]'}`}>
          1 · Email
        </span>
        <span className={`rounded-full px-3 py-1 ${step === 'wallet' ? 'bg-[var(--ink)] text-white' : 'bg-[var(--soft)] text-[var(--muted)]'}`}>
          2 · Wallet
        </span>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-[var(--sh)]">
        {step === 'email' ? (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Add email for receipts</h2>
            <p className="text-sm text-[var(--muted)]">Used for invoices and recovery. Not required to use the product.</p>
            {!challenge ? (
              <form onSubmit={(e) => void startOtp(e)} className="space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-full bg-[var(--ink)] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Send verification code
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void verifyOtp(e)} className="space-y-3">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm"
                  required
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-full bg-[var(--ink)] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Verify email
                </button>
              </form>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMsg('');
                setStep('wallet');
              }}
              className="w-full rounded-full border border-[var(--line)] py-2.5 text-sm font-medium"
            >
              Skip for now
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Connect payout wallet</h2>
            <p className="text-sm text-[var(--muted)]">
              Whitechain / injected EVM wallet for plan payouts. You can connect later from Account.
            </p>
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-full bg-[var(--ink)] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() =>
                void connectWhitechainWallet()
                  .then(({ address }) => saveWallet(address))
                  .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
              }
            >
              Connect Whitechain wallet
            </button>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void saveWallet(wallet);
              }}
            >
              <input
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Or paste 0x… address"
                className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 font-mono text-sm"
              />
              <button
                type="submit"
                disabled={busy || !wallet.trim()}
                className="w-full rounded-full border border-[var(--line)] py-2.5 text-sm font-medium disabled:opacity-60"
              >
                Save address
              </button>
            </form>
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="w-full rounded-full border border-[var(--line)] py-2.5 text-sm font-medium"
            >
              Skip and go to dashboard
            </button>
          </div>
        )}
        {msg ? <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--muted)]">{msg}</p> : null}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[var(--muted)]">Loading…</div>}>
      <OnboardingInner />
    </Suspense>
  );
}
