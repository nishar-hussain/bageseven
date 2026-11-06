'use client';

import { useEffect, useState } from 'react';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { useOperator } from '../../../lib/use-operator';
import { connectWhitechainWallet } from '@bagseven/sdk/wallet';

export default function AccountPage() {
  const op = useOperator();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [msg, setMsg] = useState('');
  const [wallet, setWallet] = useState('');

  useEffect(() => {
    if (op.walletAddress) setWallet(op.walletAddress);
  }, [op.walletAddress]);

  const startOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('Sending code…');
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
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
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
    setMsg(`Email verified: ${json.email}. Refresh the page.`);
  };

  const saveWallet = async (address: string) => {
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
    setWallet(json.wallet_address ?? address);
    setMsg(`Wallet saved: ${json.wallet_address ?? address}`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          World is primary. Email and payout wallet are optional — add them whenever you want.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)] space-y-2 text-sm">
        <h2 className="text-base font-semibold">World identity</h2>
        <div>
          Holder: <code className="fi-mono text-xs">{op.holder || '—'}</code>
        </div>
        <div>
          World human id: <code className="fi-mono text-xs">{op.worldHumanId || '—'}</code>
        </div>
        <div>
          Email: {op.email ?? 'not set'} {op.emailVerified ? '(verified)' : op.email ? '(unverified)' : ''}
        </div>
        <div>
          Wallet:{' '}
          {op.walletAddress || wallet ? (
            <code className="fi-mono text-xs">{op.walletAddress || wallet}</code>
          ) : (
            'not set'
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)] space-y-3">
        <h2 className="text-base font-semibold">Email</h2>
        <p className="text-sm text-[var(--muted)]">For receipts and recovery. Not required to operate.</p>
        <form onSubmit={(e) => void startOtp(e)} className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-full border border-[var(--line)] px-4 text-sm font-semibold">
            Send OTP
          </button>
        </form>
        {challenge ? (
          <form onSubmit={(e) => void verifyOtp(e)} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              required
            />
            <button type="submit" className="rounded-full bg-[var(--ink)] px-4 text-sm font-semibold text-white">
              Verify
            </button>
          </form>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)] space-y-3">
        <h2 className="text-base font-semibold">Payout wallet</h2>
        <p className="text-sm text-[var(--muted)]">
          Whitechain / injected EVM wallet for plan payouts. Connect or paste an address.
        </p>
        <button
          type="button"
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold"
          onClick={() =>
            void connectWhitechainWallet()
              .then(({ address }) => saveWallet(address))
              .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
          }
        >
          Connect Whitechain wallet
        </button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveWallet(wallet);
          }}
        >
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
            className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-sm"
          />
          <button type="submit" className="rounded-full bg-[var(--ink)] px-4 text-sm font-semibold text-white">
            Save
          </button>
        </form>
      </section>

      {msg && <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{msg}</p>}
    </div>
  );
}
