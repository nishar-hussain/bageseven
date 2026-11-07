'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useEffect, useRef } from 'react';
import { whitechainTestnet } from '../../lib/wagmi-config';

type Props = {
  /** Compact for headers / embed chrome */
  compact?: boolean;
  /** Persist connected address to console account when signed in */
  persistToAccount?: boolean;
  className?: string;
  onConnected?: (address: `0x${string}`) => void;
};

/**
 * RainbowKit connect control. Prefer Whitechain Testnet (1874).
 * Optionally POST the address to /api/auth/wallet after connect.
 */
export function ConnectWallet({ compact = false, persistToAccount = false, className, onConnected }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const last = useRef<string | null>(null);
  const initialChain = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    if (last.current === address) return;
    last.current = address;
    onConnected?.(address);
    if (!persistToAccount) return;
    void fetch('/api/auth/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet_address: address }),
    }).catch(() => {
      /* ignore — user may be on public embed without session */
    });
  }, [address, isConnected, onConnected, persistToAccount]);

  useEffect(() => {
    if (!isConnected || !address) { initialChain.current = null; return; }
    if (initialChain.current === address) return;
    initialChain.current = address;
    if (chainId === whitechainTestnet.id) return;
    try {
      switchChain?.({ chainId: whitechainTestnet.id });
    } catch {
      /* user may reject */
    }
  }, [address, chainId, isConnected, switchChain]);

  return (
    <div className={className}>
      <ConnectButton
        accountStatus={compact ? 'avatar' : 'full'}
        chainStatus={compact ? 'icon' : 'full'}
        showBalance={!compact}
        label="Connect wallet"
      />
    </div>
  );
}

/** Minimal RainbowKit button for embed checkout chrome. */
export function EmbedWalletBar() {
  return (
    <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} label="Connect wallet" />
  );
}
