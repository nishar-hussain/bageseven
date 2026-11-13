'use client';

import { Suspense, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAccountWallet } from '../../../components/wallet/AccountWallet';
import { accountWalletState } from '../../../lib/account-wallet-state';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import styles from '../../../components/app/auth.module.css';
import { appDestination } from '../../../lib/auth-destination';
import { ConnectWallet } from '../../../components/wallet/ConnectWallet';

function OnboardingInner() {
  const params = useSearchParams();
  const next = appDestination(params.get('next'));
  const { address, isConnected } = useAccount();
  const account = useAccountWallet();
  const state = accountWalletState({ loaded: account.loaded, failed: Boolean(account.error), linked: account.profile?.wallet_address, connected: isConnected ? address : null });
  const linked = Boolean(account.profile?.email_verified && state === 'verified');
  const [message, setMessage] = useState('');
  const guidance = state === 'verified' ? 'Your saved wallet is connected. You can finish without signing another ownership message.' : state === 'reconnect' ? 'Reconnect the wallet already linked to your email. Disconnecting never removes its saved binding.' : state === 'different' ? 'A different wallet is connected. Switch to your linked account or use the explicit replacement flow below.' : state === 'loading' ? 'Loading your account…' : 'Your email is verified. Connect your wallet and review the ownership signature to finish.';
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/onboarding/complete', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not finish setup');
      window.location.replace(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not finish setup');
      setBusy(false);
    }
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
            Your wallet.
            <br />
            Your authority.
          </h2>
          <p>Your email keeps you connected. Your wallet approves the actions that need your authority.</p>
        </div>
        <small>ACCOUNT SETUP / AVALANCHE</small>
      </aside>
      <main className={styles.formSide}>
        <div className={styles.form}>
          <p className={styles.eyebrow}>ONE MORE STEP</p>
          <h1>{account.profile?.wallet_address ? 'Reconnect your wallet.' : 'Link your wallet.'}</h1>
          <p className={styles.description}>
            Connect an Avalanche wallet and approve the ownership signature. Your email receives account
            messages; your wallet authorizes payments and permissions.
          </p>
          <div className={styles.steps}>
            <span>01 · Email verified</span>
            <span>02 · Wallet ownership</span>
          </div>
          <div className={styles.wallet}>
            <ConnectWallet
              persistToAccount
              onLinked={(address) => {
                setMessage(`Wallet verified: ${address}. Finishing setup…`);
                void finish();
              }}
              onLinkError={setMessage}
            />
          </div>
          {linked && (
            <button className={styles.continue} disabled={busy} onClick={() => void finish()}>
              {busy ? 'Finishing setup…' : 'Complete setup →'}
            </button>
          )}
          <p className={styles.message} role="status">
            {message || guidance}
          </p>
          <p className={styles.note}>
            The ownership signature is not a payment or token approval. Review it in your wallet. Bagseven
            never asks for your private key.
          </p>
        </div>
      </main>
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
