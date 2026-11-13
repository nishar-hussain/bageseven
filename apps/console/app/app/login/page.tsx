'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ConnectWallet } from '../../../components/wallet/ConnectWallet';
import { appDestination } from '../../../lib/auth-destination';
import { watchLoginSession } from '../../../lib/login-handoff';
import styles from '../../../components/app/auth.module.css';

function LoginForm() {
  const params = useSearchParams();
  const next = appDestination(params.get('next'));
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(
    params.get('error') === 'expired'
      ? 'That link has expired or was already used. Request a new one below.'
      : params.get('error') === 'misconfigured'
        ? 'Sign-in is temporarily unavailable. Please try again later.'
        : '',
  );
  const [error, setError] = useState(Boolean(params.get('error')));
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const sent = Boolean(challenge);
  useEffect(
    () =>
      watchLoginSession(() => {
        // A full navigation lets middleware apply the latest session and onboarding gate.
        window.location.replace(next);
      }),
    [next],
  );

  const readJson = async (response: Response) => {
    const text = await response.text();
    if (!text) return {} as { error?: string; challenge?: string; email?: string; dev_hint?: string };
    try {
      return JSON.parse(text) as { error?: string; challenge?: string; email?: string; dev_hint?: string };
    } catch {
      throw Error(response.ok ? 'Unexpected sign-in response' : `Sign-in failed (${response.status})`);
    }
  };
  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(false); setMessage('Sending your verification code…');
    try {
      const response = await fetch('/api/auth/email/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(20000) });
      const body = await readJson(response);
      if (!response.ok) throw Error(body.error || 'Could not send your code');
      setChallenge(body.challenge ?? ''); setCode('');
      setMessage(body.dev_hint ? 'Development code: ' + body.dev_hint : 'Code sent to ' + email + '. Enter it here within 10 minutes.');
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : 'Could not send your code'); }
    finally { setBusy(false); }
  };
  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(false); setMessage('Verifying your email…');
    try {
      const response = await fetch('/api/auth/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, challenge }), signal: AbortSignal.timeout(20000) });
      const body = await readJson(response); if (!response.ok) throw Error(body.error || 'Invalid or expired code');
      window.location.replace(next);
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : 'Could not verify your email'); setBusy(false); }
  };

  return (
    <div className={styles.page}>
      <aside className={styles.story}>
        <a className={styles.brand} href={process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://localhost:3001'}>
          <Image src="/icon.svg" width={32} height={32} alt="" />
          Bagseven
        </a>
        <div>
          <h2>
            Your product.
            <br />
            Their access.
            <br />
            One workspace.
          </h2>
          <p>Manage plans, customer credits and agent permissions, connected on Avalanche.</p>
        </div>
        <small>ACCESS, ON YOUR TERMS.</small>
      </aside>
      <main className={styles.formSide}>
        <div className={styles.form}>
          <p className={styles.eyebrow}>YOUR BAGSEVEN WORKSPACE</p>
          <h1>{sent ? 'Confirm your email.' : 'Your workspace starts here.'}</h1>
          <p className={styles.description}>
            Enter your email, connect your wallet and confirm the email code. New accounts finish with a wallet ownership signature.
          </p>
          <div className={styles.steps}><span>01 · Email code</span><span>02 · Wallet ownership</span></div>
          <form onSubmit={(e) => void sendCode(e)}>
            <label htmlFor="sign-in-email">Work email</label>
            <input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              required
              disabled={sent || busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : sent ? 'Send a new code' : 'Send verification code →'}
            </button>
          </form>
          {sent && <>
            <div className={styles.wallet}><ConnectWallet /><p className={styles.note}>Connecting does not link or replace an account wallet. Confirm your email first, then review the ownership signature.</p></div>
            <form onSubmit={event => void verifyCode(event)}>
              <label htmlFor="email-code">Email verification code</label>
              <input id="email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={event => setCode(event.target.value)} required placeholder="6-digit code" />
              <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Verify email & continue →'}</button>
            </form>
            <button type="button" className={styles.changeEmail} disabled={busy} onClick={() => { setChallenge(''); setCode(''); setMessage(''); setError(false); }}>Use another email</button>
          </>}
          {message && (
            <p
              role={error ? 'alert' : 'status'}
              className={`${styles.message} ${error ? styles.messageError : ''}`}
            >
              {message}
            </p>
          )}
          <p className={styles.note}>
            You can enter the email code in this window. Your linked wallet stays saved when you disconnect; returning customers can reconnect it without linking it again.
            <br /><br />
            Wallet keys stay with you. You’ll review ownership signatures and payment approvals in your
            wallet.
          </p>
          <a className={styles.back} href={process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://localhost:3001'}>
            ← Back to Bagseven
          </a>
        </div>
      </main>
    </div>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-10">Loading sign-in…</div>}>
      <LoginForm />
    </Suspense>
  );
}
