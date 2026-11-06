import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@bagseven/sdk'],
  // RainbowKit → wagmi connectors touch optional Coinbase CDP / x402 peers.
  serverExternalPackages: ['@coinbase/cdp-sdk', '@base-org/account'],
  // Console is opened as both localhost and 127.0.0.1; without this, Next 16
  // blocks /_next HMR + RSC from the "other" host and client pages stick on Loading…
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
