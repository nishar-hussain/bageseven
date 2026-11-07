import type { PrivateKeyAccount } from 'viem/accounts';
let resolver: ((provider: string) => Promise<PrivateKeyAccount>) | undefined;
export function configureProviderGrantSigners(value: (provider: string) => Promise<PrivateKeyAccount>) { resolver = value; }
export async function providerGrantSigner(provider?: string) {
  if (!provider || !resolver) throw new Error('PROVIDER_GAS_REQUIRED: configure and fund the provider gas account before writing entitlements');
  return resolver(provider);
}
