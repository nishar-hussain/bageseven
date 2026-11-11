'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSignMessage, useSwitchChain } from 'wagmi';
import { useEffect, useRef, useState } from 'react';
import { avalancheFuji } from '../../lib/wagmi-config';

type Props = {
  /** Compact for headers / embed chrome */
  compact?: boolean;
  /** Persist connected address to console account when signed in */
  persistToAccount?: boolean;
  className?: string;
  onConnected?: (address: `0x${string}`) => void;
  onLinked?: (address: `0x${string}`) => void;
  onLinkError?: (message: string) => void;
};

/**
 * RainbowKit connect control. Prefer Avalanche Fuji (43113).
 * Persisted accounts require an explicit ownership signature, never just a pasted address.
 */
export function ConnectWallet({ compact = false, persistToAccount = false, className, onConnected, onLinked, onLinkError }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [linked, setLinked] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState('');
  const initialChain = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    onConnected?.(address);
  }, [address, isConnected, onConnected]);

  const linkWallet = async () => {
    if (!address || linking) return;
    setLinking(true);
    setMessage('Approve the wallet ownership signature.');
      try {
        const challenge = await fetch(`/api/auth/wallet/verify?owner=${encodeURIComponent(address)}`, { cache: 'no-store' });
        const payload = (await challenge.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
        if (!challenge.ok || !payload.message) throw new Error(payload.error?.message || 'Could not prepare wallet verification');
        const signature = await signMessageAsync({ message: payload.message });
        const verified = await fetch('/api/auth/wallet/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signature }),
        });
        const result = (await verified.json().catch(() => ({}))) as { wallet_address?: `0x${string}`; error?: { message?: string } };
        if (!verified.ok || !result.wallet_address) throw new Error(result.error?.message || 'Wallet ownership could not be verified');
        setLinked(address);
        setMessage('Wallet ownership verified.');
        onLinked?.(result.wallet_address);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Wallet ownership could not be verified';
        setMessage(detail);
        onLinkError?.(detail);
      } finally {
        setLinking(false);
      }
  };

  useEffect(() => {
    if (!isConnected || !address) { initialChain.current = null; return; }
    if (initialChain.current === address) return;
    initialChain.current = address;
    if (chainId === avalancheFuji.id) return;
    try {
      switchChain?.({ chainId: avalancheFuji.id });
    } catch {
      /* user may reject */
    }
  }, [address, chainId, isConnected, switchChain]);

  return (
    <div className={`min-w-0 max-w-full ${className ?? ''}`}>
      <ConnectButton
        accountStatus={compact ? 'avatar' : { smallScreen: 'address', largeScreen: 'full' }}
        chainStatus={compact ? 'icon' : { smallScreen: 'icon', largeScreen: 'full' }}
        showBalance={compact ? false : { smallScreen: false, largeScreen: true }}
        label="Connect wallet"
      />
      {persistToAccount && isConnected && address ? (
        <button type="button" disabled={linking || linked === address} onClick={() => void linkWallet()}
          className="mt-3 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium disabled:opacity-60">
          {linking ? 'Verifying…' : linked === address ? 'Wallet verified' : 'Sign to link wallet'}
        </button>
      ) : null}
      {message ? <p role="status" className="mt-2 max-w-sm break-words text-sm text-[var(--muted)]">{message}</p> : null}
    </div>
  );
}

/** Minimal RainbowKit button for embed checkout chrome. */
export function EmbedWalletBar() {
  return (
    <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} label="Connect wallet" />
  );
}
