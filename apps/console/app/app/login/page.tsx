'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/app';
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('Sending…');
    const res = await fetch('/api/auth/magic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, next }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error ?? 'Could not send link');
      return;
    }
    setSent(true);
    setMsg(
      json.dev_hint
        ? `Dev: ${json.dev_hint}`
        : `Check ${email} for a sign-in link from Bagseven. Session lasts 8 hours.`,
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f2f2] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-xl font-semibold text-[#0002f8]">Bagseven</span>
          <span className="rounded-md bg-[#f2f3ff] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#0002f8]">Beta</span>
        </div>
        <div className="rounded-[16px] border border-[#ececf0] bg-white p-8 shadow-[0_1px_2px_#0e0e100d,0_18px_40px_-18px_#0e0e102e]">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[#63636d]">Any work email. We send a magic link from bags@cesthq.com.</p>
          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#63636d]">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 w-full rounded-xl border border-[#ececf0] px-3 py-2.5 text-sm"
              />
            </label>
            <button type="submit" className="w-full rounded-full bg-[#0e0e10] py-2.5 text-sm font-semibold text-white">
              Email me a link
            </button>
          </form>
          {msg && <p className="mt-4 text-sm text-[#63636d]">{msg}</p>}
          {sent && !msg.startsWith('Dev:') && (
            <p className="mt-2 text-xs text-[#6f6f78]">Didn’t get it? Check spam. The link expires in 15 minutes.</p>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-[#6f6f78]">A session lasts 8 hours.</p>
      </div>
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
