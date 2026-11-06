'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig, whitechainTestnet } from '../../lib/wagmi-config';
import '@rainbow-me/rainbowkit/styles.css';

/** RainbowKit + wagmi + react-query for console + embed checkout. */
export function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={whitechainTestnet}
          theme={lightTheme({ accentColor: '#0f172a', borderRadius: 'large' })}
          modalSize="compact"
          appInfo={{
            appName: 'Bagseven',
            learnMoreUrl: 'https://rainbowkit.com/docs/introduction',
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
