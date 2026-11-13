'use client';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { dismissWalletReminder, getWalletOperation, subscribeWalletOperation } from './wallet-operations.js';
const Managed = createContext(false);
const idle = { active: null, reminder: null };
function Notice({ floating = false }: { floating?: boolean }) {
  const state = useSyncExternalStore(subscribeWalletOperation, getWalletOperation, () => idle);
  if (!state.active && !state.reminder) return null;
  return <aside aria-label="Wallet approval status" data-bagseven-wallet-notice style={{
    ...(floating ? { position: 'fixed', bottom: 20, right: 20, zIndex: 90, width: 'min(340px, calc(100vw - 40px))', boxShadow: '0 4px 20px #1d243312' } : { margin: '12px 0' }),
    background: 'var(--bs-card, #fff)', border: '1px solid var(--bs-line, #e1e3e9)', borderRadius: 10,
    padding: '12px 14px', color: 'var(--bs-ink, #1d2433)', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5,
  }}>
    <strong style={{ display: 'block', marginBottom: 4 }}>{state.reminder ? 'Check your wallet' : state.active}</strong>
    <p role="status" style={{ margin: 0, color: '#667086' }}>{state.reminder ? state.reminder.startsWith('Another Bagseven') ? 'Another tab is using your wallet. Finish its request before continuing here.' : 'A previous wallet request is still open. Review or dismiss it in your wallet before continuing.' : 'Review the request in your wallet. You can continue once it finishes.'}</p>
    {!state.active && state.reminder && <><button type="button" onClick={dismissWalletReminder} style={{ marginTop: 8, padding: '7px 10px', background: 'var(--bs-accent, #112d94)', color: '#fff', border: 0, borderRadius: 7, cursor: 'pointer' }}>I’ve resolved it</button><p style={{ margin: '6px 0 0', color: '#667086', fontSize: 11 }}>If you paid, confirm that payment below. Don’t pay again.</p></>}
  </aside>;
}
export function WalletOperationBoundary({ children }: { children: ReactNode }) {
  return <Managed.Provider value={true}>{children}<Notice floating /></Managed.Provider>;
}
export function WalletOperationNotice() { return useContext(Managed) ? null : <Notice />; }
