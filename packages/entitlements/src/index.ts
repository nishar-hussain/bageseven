import { ArkivGrantStore } from './arkiv-store.js';
import { MemoryGrantStore } from './memory-store.js';
import type { GrantStore } from './types.js';

export * from './types.js';
export * from './features.js';
export { MemoryGrantStore } from './memory-store.js';
export { ArkivGrantStore } from './arkiv-store.js';
export { BagsevenGrants } from './schema.js';
export { explorerUrl, recordWhitechainPayment } from './whitechain-settlement.js';

let singleton: GrantStore | undefined;

/**
 * Process-wide grant store.
 * - Memory by default (unit tests / offline).
 * - Real Arkiv only when access key + private key exist (RPC URL alone is not enough).
 */
export function getGrantStore(env: NodeJS.ProcessEnv = process.env): GrantStore {
  if (singleton) return singleton;
  const mode = (env.ENTITLEMENT_STORE ?? '').toLowerCase();
  const hasCreds = Boolean(env.ARKIV_ACCESS_KEY && (env.ARKIV_PRIVATE_KEY || env.PRIVATE_KEY));
  if (hasCreds || mode === 'arkiv') {
    singleton = ArkivGrantStore.fromEnv(env);
  } else {
    singleton = new MemoryGrantStore();
  }
  return singleton;
}

export function resetGrantStoreForTests(): void {
  singleton = undefined;
}
