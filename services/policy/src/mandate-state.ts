import type { MandateClient } from '@bagseven/onchain';
import type { Address } from 'viem';

export type ChainState = { status: 'available' } | {
  status: 'unavailable'; code: 'NO_CONTRACT' | 'RPC_UNAVAILABLE' | 'CONTRACT_UNSUPPORTED'; message: string;
};
const unavailable = (code: 'NO_CONTRACT' | 'RPC_UNAVAILABLE' | 'CONTRACT_UNSUPPORTED', message: string) => ({ status: 'unavailable' as const, code, message });

/** A missing/old deployment is unavailable, never implicitly active or revoked. */
export async function readMandateAvailability(client: MandateClient, contract: Address | null) {
  if (!contract) return { chain: unavailable('NO_CONTRACT', 'This mandate has no deployed contract on the configured network. Create a mandate on the current network.'), revoked: null };
  try {
    const code = await client.publicClient.getCode({ address: contract });
    if (!code || code === '0x') return { chain: unavailable('NO_CONTRACT', 'No contract exists at this mandate address on the configured network. Select the correct network or create a new mandate there.'), revoked: null };
  } catch {
    return { chain: unavailable('RPC_UNAVAILABLE', 'The configured network is unavailable. Retry when the RPC connection is restored.'), revoked: null };
  }
  try { return { chain: { status: 'available' as const }, revoked: await client.isRevoked(contract) }; }
  catch { return { chain: unavailable('CONTRACT_UNSUPPORTED', 'This deployment could not be read as a supported mandate. Check the network and deployment before spending.'), revoked: null }; }
}

/** Read all money values together; a partial read must never imply spendable capacity. */
export async function readMandateSnapshot(client: MandateClient, contract: Address | null) {
  const availability = await readMandateAvailability(client, contract);
  const empty = { ...availability, vault: 0n, windowSpent: 0n, lifetimeSpent: 0n, token: null as Address | null };
  if (availability.chain.status !== 'available' || !contract) return empty;
  try {
    const [vault, windowSpent, lifetimeSpent, token] = await Promise.all([
      client.vaultBalance(contract), client.spendState(contract), client.lifetimeSpent(contract), client.token(contract),
    ]);
    return { ...availability, vault, windowSpent, lifetimeSpent, token };
  } catch {
    return { ...empty, chain: unavailable('CONTRACT_UNSUPPORTED', 'The mandate state could not be loaded from this deployment. Spending is disabled until its network and contract can be verified.'), revoked: null };
  }
}
