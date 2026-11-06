'use client';

import { useAccount } from 'wagmi';
import { ConnectWallet } from './ConnectWallet';
import { StatusPill } from '../app/ui';

/** Compact connected / not-connected status for Tracks & Account (not the top header). */
export function WalletStatusCard({
  title = 'Wallet',
  persistToAccount = false,
}: {
  title?: string;
  persistToAccount?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            RainbowKit on Whitechain Testnet — used for customer checkout and optional payout link.
          </p>
        </div>
        <StatusPill tone={isConnected ? 'good' : 'warn'}>
          {isConnected ? 'Connected' : 'Not connected'}
        </StatusPill>
      </div>
      {short ? (
        <p className="mt-3 fi-mono text-xs text-[var(--muted)]" title={address}>
          {short}
        </p>
      ) : null}
      <div className="mt-4">
        <ConnectWallet persistToAccount={persistToAccount} />
      </div>
    </section>
  );
}
