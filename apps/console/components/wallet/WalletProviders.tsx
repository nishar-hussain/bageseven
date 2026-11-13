'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, type AvatarComponent } from '@rainbow-me/rainbowkit';
import { Wallet } from 'lucide-react';
import { WalletOperationBoundary } from '../../lib/bagseven-sdk-react';
import { AccountWalletProvider } from './AccountWallet';
import { walletTheme } from './theme';
import { WagmiProvider } from 'wagmi';
import { avalancheFuji, wagmiConfig } from '../../lib/wagmi-config';
import '@rainbow-me/rainbowkit/styles.css';

const WalletAvatar: AvatarComponent = ({ size }) => <div aria-hidden="true" style={{ width: size, height: size, borderRadius: '30%', background: '#edf0fb', color: '#112d94', display: 'grid', placeItems: 'center', border: '1px solid #dce2f2' }}><Wallet size={size * 0.44} strokeWidth={1.5} /></div>;

/** RainbowKit + wagmi + react-query for console + embed checkout. */
export function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const rpc = avalancheFuji.rpcUrls.default.http[0];
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(rpc);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={avalancheFuji}
          theme={walletTheme}
          avatar={WalletAvatar}
          modalSize="compact"
          appInfo={{
            appName: 'Bagseven',
            learnMoreUrl: (process.env.NEXT_PUBLIC_LANDING_URL || 'http://localhost:3001') + '/docs/introduction',
          }}
        >
          {local && (
            <div
              role="status"
              className="border-b border-[var(--line)] bg-[var(--soft)] px-4 py-2 text-center text-xs"
            >
              Local Anvil · chain 43113 · wallet RPC: {rpc} · development funds only
            </div>
          )}
          <WalletOperationBoundary><AccountWalletProvider>{children}</AccountWalletProvider></WalletOperationBoundary>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
