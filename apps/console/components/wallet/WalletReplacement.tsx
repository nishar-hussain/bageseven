'use client';
import { useState } from 'react';
import { errorMessage } from '../../lib/error-message';
import styles from './wallet.module.css';
export function WalletReplacement({ email, address, onVerified, onCancel }: {
  email: string; address: string; onVerified: () => Promise<void>; onCancel: () => void;
}) {
  const [challenge, setChallenge] = useState(''), [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function send() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/email/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(20000) });
      const data = await response.json(); if (!response.ok) throw Error(errorMessage(data.error));
      setChallenge(data.challenge); setCode(''); setConfirmed(false);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      if (!confirmed) {
        const response = await fetch('/api/auth/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code }), signal: AbortSignal.timeout(20000) });
        const data = await response.json(); if (!response.ok) throw Error(errorMessage(data.error));
        setConfirmed(true);
      }
      await onVerified();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className={styles.replacement} aria-label="Replace account wallet">
    <h3>Replace your linked wallet</h3>
    <p>Confirm access to <strong>{email}</strong>, then sign with <code>{address}</code>. Your current wallet stays linked until the new signature is verified. Existing payouts and spending permissions are not transferred.</p>
    {!challenge ? <button className={styles.connect} disabled={busy} onClick={() => void send()}>{busy ? 'Sending code…' : 'Send confirmation code'}</button> :
      <form onSubmit={event => void verify(event)}>
        {!confirmed && <label>Email confirmation code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={event => setCode(event.target.value)} placeholder="6-digit code" /></label>}
        {confirmed && <p role="status">Email confirmed. Review the ownership signature for the new wallet.</p>}
        <button className={styles.connect} disabled={busy} type="submit">{busy ? 'Completing verification…' : confirmed ? 'Sign to replace wallet' : 'Verify code & sign wallet'}</button>
        <button className={styles.verify} type="button" disabled={busy} onClick={() => void send()}>Send a new code</button>
      </form>}
    <button className={styles.verify} disabled={busy} type="button" onClick={onCancel}>Cancel replacement</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
