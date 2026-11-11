import { AvalancheGrantStore } from './avalanche-store.js';
import { MemoryGrantStore } from './memory-store.js';
import type { GrantStore } from './types.js';

export * from './types.js';
export * from './features.js';
export { MemoryGrantStore } from './memory-store.js';
export { AvalancheGrantStore } from './avalanche-store.js';
export { configureProviderGrantSigners } from './provider-signers.js';
export { explorerUrl, recordAvalanchePayment } from './avalanche-settlement.js';

let singleton: GrantStore | undefined;

/**
 * Process-wide grant store.
 * - Production uses Avalanche contract state plus private PostgreSQL metadata.
 * - Tests must explicitly select memory (or run with NODE_ENV=test).
 * - Registry writes always require the provider's authorized signer.
 */
export function getGrantStore(env: NodeJS.ProcessEnv = process.env): GrantStore {
  if (singleton) return singleton;
  const mode = (env.ENTITLEMENT_STORE ?? '').toLowerCase();
  if (mode === 'memory' && env.NODE_ENV !== 'production' || !mode && env.NODE_ENV === 'test') {
    singleton = new MemoryGrantStore();
  } else {
    if (mode && mode !== 'avalanche') throw Error('ENTITLEMENT_STORE_UNSUPPORTED: use avalanche');
    singleton = AvalancheGrantStore.fromEnv(env);
  }
  return singleton;
}

export function resetGrantStoreForTests(): void {
  singleton = undefined;
}
