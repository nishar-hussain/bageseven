'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ConnectWallet } from '../../../components/wallet/ConnectWallet';

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/app';
  const [message, setMessage] = useState('Connect your Avalanche Fuji wallet, then approve the ownership signature.');
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/onboarding/complete', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not finish setup');
      router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/app');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not finish setup');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Secure account setup</p>
        <h1 className="mt-2 text-[2rem] font-semibold tracking-tight">Link your Avalanche wallet</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Your email receives invoices and receipts. Your wallet is the authority for checkout, payouts, and agent spending permissions.</p>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-[var(--sh)]">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="rounded-full bg-[var(--soft)] px-3 py-1 text-[var(--muted)]">1 · Email verified</span>
          <span className="rounded-full bg-[var(--ink)] px-3 py-1 text-white">2 · Wallet signature</span>
        </div>
        <div className="mt-5 flex justify-center">
          <ConnectWallet
            persistToAccount
            onLinked={(address) => {
              setMessage(`Wallet verified: ${address}. Finishing setup…`);
              void finish();
            }}
            onLinkError={setMessage}
          />
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">The signature proves you control this address. It is not a transaction, does not grant token approval, and cannot move funds.</p>
        {busy ? <p className="mt-4 text-sm text-[var(--muted)]">Finishing setup…</p> : null}
        {message ? <p className="mt-4 break-words whitespace-pre-wrap text-sm text-[var(--muted)]">{message}</p> : null}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={<div className="p-10 text-sm text-[var(--muted)]">Loading…</div>}><OnboardingInner /></Suspense>;
}
