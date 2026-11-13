'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { avalancheFuji, wagmiConfig } from '../../lib/wagmi-config';
import '@rainbow-me/rainbowkit/styles.css';

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
          theme={lightTheme({ accentColor: '#0f172a', borderRadius: 'large' })}
          modalSize="compact"
          appInfo={{
            appName: 'Bagseven',
            learnMoreUrl: 'https://rainbowkit.com/docs/introduction',
          }}
        >
          {local && <div role="status" className="border-b border-[var(--line)] bg-[var(--soft)] px-4 py-2 text-center text-xs">Local Anvil · chain 43113 · wallet RPC: {rpc} · development funds only</div>}
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
