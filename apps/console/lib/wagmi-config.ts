'use client';

import { connectorsForWallets, type Chain } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';

/** Whitechain Testnet — product money rail (chain id 1874). */
export const whitechainTestnet = {
  id: 1874,
  name: 'Whitechain Testnet',
  iconUrl: 'https://explorer.testnet.whitechain.io/favicon.ico',
  iconBackground: '#0f172a',
  nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_WHITECHAIN_RPC_URL || 'https://rpc.testnet.whitechain.io'] },
  },
  blockExplorers: {
    default: {
      name: 'Whitechain Explorer',
      url: process.env.NEXT_PUBLIC_WHITECHAIN_EXPLORER || 'https://explorer.testnet.whitechain.io',
    },
  },
} as const satisfies Chain;

/** Whitechain mainnet (1875). */
export const whitechainMainnet = {
  id: 1875,
  name: 'Whitechain',
  iconUrl: 'https://explorer.whitechain.io/favicon.ico',
  iconBackground: '#0f172a',
  nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_WHITECHAIN_MAINNET_RPC_URL || 'https://rpc.whitechain.io'] },
  },
  blockExplorers: {
    default: { name: 'Whitechain Explorer', url: 'https://explorer.whitechain.io' },
  },
} as const satisfies Chain;

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  // Local/dev fallback so ConnectButton mounts; set a real id from cloud.walletconnect.com for prod.
  'bagseven_local_dev_project';

/**
 * Explicit wallet list — avoid getDefaultConfig() Coinbase/Base Account path
 * (pulls @coinbase/cdp-sdk → missing @x402/evm under Turbopack).
 */
const connectors = connectorsForWallets(
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
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [whitechainTestnet, whitechainMainnet, {
    id: 7794095, name: 'Arkiv Rabdi', nativeCurrency: { name: 'Golem', symbol: 'tGLM', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'] } },
    blockExplorers: { default: { name: 'Arkiv Explorer', url: 'https://explorer.rabdi.db-chain.testnet.arkiv.network' } },
  }],
  transports: {
    [whitechainTestnet.id]: http(whitechainTestnet.rpcUrls.default.http[0]),
    [whitechainMainnet.id]: http(whitechainMainnet.rpcUrls.default.http[0]),
    7794095: http('https://rpc.rabdi.db-chain.testnet.arkiv.network'),
  },
  ssr: true,
});
