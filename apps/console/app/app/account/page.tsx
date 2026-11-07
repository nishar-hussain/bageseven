'use client';

import { useEffect, useState } from 'react';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard, StatusPill } from '../../../components/app/ui';
import { WalletStatusCard } from '../../../components/wallet/WalletStatus';
import { useOperator } from '../../../lib/use-operator';
import { IdentityValue } from '../../../components/app/IdentityValue';

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (hash === 'email' || hash === 'wallet') {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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
    setMsg(`Email verified: ${json.email}`);
    window.location.reload();
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
      <PageHeader title="Account" description="World identity. Email and wallet are optional." />

      <SoftCard className="space-y-3 p-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">Identity</h2>
          {!op.emailVerified ? <StatusPill tone="warn">Email pending</StatusPill> : <StatusPill tone="good">Email verified</StatusPill>}
          {!op.walletAddress && !wallet ? <StatusPill tone="warn">Wallet pending</StatusPill> : <StatusPill tone="good">Wallet set</StatusPill>}
        </div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
          <dt className="text-[var(--muted)]">Holder</dt>
          <dd className="min-w-0"><IdentityValue value={op.holder} label="holder" /></dd>
          <dt className="text-[var(--muted)]">World ID</dt>
          <dd className="min-w-0"><IdentityValue value={op.worldHumanId} label="World ID" /></dd>
          <dt className="text-[var(--muted)]">Email</dt>
          <dd className="min-w-0 break-all">{op.email ?? 'Not set'}</dd>
          <dt className="text-[var(--muted)]">Wallet</dt>
          <dd className="min-w-0"><IdentityValue value={op.walletAddress || wallet} label="wallet address" /></dd>
        </dl>
      </SoftCard>

      <SoftCard id="email" className="scroll-mt-20 space-y-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">Email</h2>
          {!op.emailVerified ? <StatusPill tone="warn">Recommended</StatusPill> : null}
        </div>
        <p className="text-[13px] text-[var(--muted)]">For receipts and recovery. Not required to operate.</p>
        <form onSubmit={(e) => void startOtp(e)} className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
          />
          <SecondaryButton type="submit">Send code</SecondaryButton>
        </form>
        {challenge ? (
          <form onSubmit={(e) => void verifyOtp(e)} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              required
            />
            <PrimaryButton type="submit">Verify</PrimaryButton>
          </form>
        ) : null}
      </SoftCard>

      <div id="wallet" className="scroll-mt-20 space-y-3">
        <WalletStatusCard title="Payout wallet" persistToAccount />
        <SoftCard className="space-y-3 p-5">
          <p className="text-[13px] text-[var(--muted)]">Or paste a Whitechain address manually.</p>
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
              className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-sm"
            />
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
        </SoftCard>
      </div>

      {msg ? <p className="break-words whitespace-pre-wrap text-sm text-[var(--muted)]">{msg}</p> : null}
    </div>
  );
}
