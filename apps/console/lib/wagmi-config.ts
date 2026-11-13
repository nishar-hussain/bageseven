'use client';

import { connectorsForWallets, type Chain } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

/** Avalanche Fuji C-Chain — Bagseven's hackathon settlement network (chain id 43113). */
export const avalancheFuji = {
  id: 43113,
  name: 'Avalanche Fuji',
  iconUrl: 'https://build.avax.network/favicon.ico',
  iconBackground: '#e84142',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'] },
  },
  blockExplorers: {
    default: {
      name: 'SnowTrace',
      url: process.env.NEXT_PUBLIC_AVALANCHE_EXPLORER || 'https://testnet.snowtrace.io',
    },
  },
} as const satisfies Chain;

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

/**
 * Explicit wallet list — avoid getDefaultConfig() Coinbase/Base Account path
 * (pulls @coinbase/cdp-sdk → missing @x402/evm under Turbopack).
 */
const connectors = projectId ? connectorsForWallets(
  [
    {
      groupName: 'Suggested',
      wallets: [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  {
    appName: 'Bagseven',
    projectId,
  },
) : [injected({ shimDisconnect: true })];

export const wagmiConfig = createConfig({
  connectors,
  chains: [avalancheFuji],
  transports: {
    [avalancheFuji.id]: http(avalancheFuji.rpcUrls.default.http[0]),
  },
  ssr: true,
});
