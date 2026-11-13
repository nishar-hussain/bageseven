export type WalletOperationState = { active: string | null; reminder: string | null };
const key = Symbol.for('bagseven.wallet-operations.v1');
type Shared = { snapshot: WalletOperationState; listeners: Set<() => void> };
const host = globalThis as typeof globalThis & { [key]?: Shared };
const shared = host[key] ??= { snapshot: { active: null, reminder: null }, listeners: new Set() };
export const getWalletOperation = () => shared.snapshot;
export const subscribeWalletOperation = (listener: () => void) => { shared.listeners.add(listener); return () => { shared.listeners.delete(listener); }; };
function update(snapshot: WalletOperationState) { shared.snapshot = snapshot; for (const listener of shared.listeners) listener(); }
export function dismissWalletReminder() {
  if (!shared.snapshot.active) update({ active: null, reminder: null });
}
function pending(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    const item = value as { code?: unknown; cause?: unknown; error?: unknown; data?: unknown; originalError?: unknown };
    return Number(item.code) === -32002 || [item.cause, item.error, item.data, item.originalError].some(visit);
  };
  return visit(error);
}

/** Fail fast; never queue, retry, time out or cancel a financial wallet request. */
export async function withWalletOperation<T>(label: string, action: () => Promise<T>): Promise<T> {
  if (shared.snapshot.active || shared.snapshot.reminder)
    throw Error(shared.snapshot.active ? 'Finish the current wallet action: ' + shared.snapshot.active + '. No additional request was sent.' : 'Finish or dismiss the request in your wallet, then acknowledge the wallet reminder before trying again.');
  update({ active: label, reminder: null });
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('bagseven-wallet-approval', { ifAvailable: true }, async lock => {
        if (!lock) {
          update({ active: label, reminder: 'Another Bagseven tab is using your wallet. Finish its approval before starting a new action here.' });
          throw Error('Another Bagseven tab is using your wallet. No additional request was sent.');
        }
        return action();
      });
    }
    return await action();
  } catch (error) {
    if (pending(error)) update({ active: label, reminder: 'Your wallet already has an unfinished request. Open the wallet extension or mobile wallet and approve or dismiss it. If a transaction was submitted, verify that transaction before paying or deploying again.' });
    throw error;
  } finally {
    update({ active: null, reminder: shared.snapshot.reminder });
  }
}
