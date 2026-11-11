'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/app';
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(params.get('error') === 'expired' ? 'That sign-in link expired. Request a new one.' : '');
  const [busy, setBusy] = useState(false);

  const sendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('Sending sign-in link…');
    try {
      const response = await fetch('/api/auth/magic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, next }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; dev_hint?: string };
      if (!response.ok) throw new Error(body.error || 'Could not send a sign-in link');
      setMessage(body.dev_hint ? `Development sign-in link: ${body.dev_hint}` : `Check ${email} for a link. It expires in 15 minutes.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send a sign-in link');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f2f2] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8"><span className="text-xl font-semibold text-[#0002f8]">Bagseven</span></div>
        <div className="rounded-[16px] border border-[#ececf0] bg-white p-8 shadow-[0_1px_2px_#0e0e100d,0_18px_40px_-18px_#0e0e102e]">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[#63636d]">Use your verified email for invoices and account recovery. You will link an Avalanche wallet before using paid features.</p>
          <form onSubmit={(event) => void sendLink(event)} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-xl border border-[#ececf0] px-3 py-2.5 text-sm"
            />
            <button type="submit" disabled={busy} className="w-full rounded-full bg-[#0e0e10] py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
          <p className="mt-5 text-xs leading-5 text-[#63636d]">Bagseven never asks for a wallet private key. Wallet signatures link authority; they do not transfer funds.</p>
          {message ? <p className="mt-4 break-all whitespace-pre-wrap text-sm text-[#63636d]">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#f2f2f2]">Loading…</div>}><LoginForm /></Suspense>;
}
