'use client';

import { useEffect, useState } from 'react';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard, StatusPill } from '../../../components/app/ui';
import { WalletStatusCard } from '../../../components/wallet/WalletStatus';
import { useOperator } from '../../../lib/use-operator';
import { errorMessage } from '../../../lib/error-message';
import { IdentityValue } from '../../../components/app/IdentityValue';

export default function AccountPage() {
  const op = useOperator();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [msgError, setMsgError] = useState(false);
  useEffect(() => { if (op.email) setEmail(op.email); }, [op.email]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (hash === 'email' || hash === 'wallet') {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const startOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('send'); setMsgError(false); setMsg('Sending your verification code…');
    try {
      const res = await fetch('/api/auth/email/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(20000) });
      const json = await res.json();
      if (!res.ok) throw Error(errorMessage(json.error, 'Could not send your code. Please retry.'));
      setChallenge(json.challenge ?? ''); setCode('');
      setMsg(json.dev_hint ? 'Development code: ' + json.dev_hint : 'Code sent to ' + email + '. Enter it below within 10 minutes.');
    } catch (error) { setMsgError(true); setMsg(errorMessage(error, 'Could not send your code. Please retry.')); }
    finally { setBusy(null); }
  };
  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('verify'); setMsgError(false); setMsg('Verifying your email…');
    try {
      const res = await fetch('/api/auth/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, challenge }), signal: AbortSignal.timeout(20000) });
      const json = await res.json();
      if (!res.ok) throw Error(errorMessage(json.error, 'That code could not be verified. Check it and try again.'));
      setMsg('Email verified. Refreshing your account…');
      window.location.reload();
    } catch (error) { setMsgError(true); setMsg(errorMessage(error)); }
    finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Account" description="Verified email for billing, signed Avalanche wallet for authority." />

      <SoftCard className="space-y-3 p-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">Identity</h2>
          {!op.emailVerified ? <StatusPill tone="warn">Email pending</StatusPill> : <StatusPill tone="good">Email verified</StatusPill>}
          {!op.walletAddress ? <StatusPill tone="warn">Wallet pending</StatusPill> : <StatusPill tone="good">Wallet verified</StatusPill>}
        </div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
          <dt className="text-[var(--muted)]">Holder</dt>
          <dd className="min-w-0"><IdentityValue value={op.holder} label="holder" /></dd>
          <dt className="text-[var(--muted)]">Email</dt>
          <dd className="min-w-0 break-all">{op.email ?? 'Not set'}</dd>
          <dt className="text-[var(--muted)]">Wallet</dt>
          <dd className="min-w-0"><IdentityValue value={op.walletAddress} label="wallet address" /></dd>
        </dl>
      </SoftCard>

      <SoftCard id="email" className="scroll-mt-20 space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">Email</h2>
          {!op.emailVerified ? <StatusPill tone="warn">Recommended</StatusPill> : null}
        </div>
        <p className="text-[13px] text-[var(--muted)]">For invoices, receipts, account recovery, and wallet-rebind confirmation.</p>
        <form onSubmit={(e) => void startOtp(e)} className="flex gap-2">
          <input
            type="email"
            aria-label="Billing email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
          />
          <SecondaryButton type="submit" disabled={Boolean(busy)}>{busy === 'send' ? 'Sending…' : challenge ? 'Resend code' : 'Send code'}</SecondaryButton>
        </form>
        {challenge ? (
          <form onSubmit={(e) => void verifyOtp(e)} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              aria-label="Email verification code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              minLength={6}
              className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              required
            />
            <PrimaryButton type="submit" disabled={Boolean(busy)}>{busy === 'verify' ? 'Verifying…' : 'Verify email'}</PrimaryButton>
          </form>
        ) : null}
      </SoftCard>

      <div id="wallet" className="scroll-mt-20 space-y-3">
        <WalletStatusCard title="Avalanche wallet" persistToAccount />
        <SoftCard className="space-y-3 p-5">
          <p className="text-[13px] text-[var(--muted)]">Wallet addresses are linked only after a signature from that wallet. To replace an existing wallet, confirm your email again and sign with the new wallet.</p>
        </SoftCard>
      </div>

      {msg ? <p role={msgError ? 'alert' : 'status'} className={"break-words whitespace-pre-wrap text-sm " + (msgError ? "text-[var(--deny)]" : "text-[var(--muted)]")}>{msg}</p> : null}
    </div>
  );
}
