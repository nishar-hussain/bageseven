'use client';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { dismissWalletReminder, getWalletOperation, subscribeWalletOperation } from './wallet-operations.js';
const Managed = createContext(false);
const idle = { active: null, reminder: null };
function Notice({ floating = false }: { floating?: boolean }) {
  const state = useSyncExternalStore(subscribeWalletOperation, getWalletOperation, () => idle);
  if (!state.active && !state.reminder) return null;
  return <aside aria-label="Wallet approval status" data-bagseven-wallet-notice style={{
    ...(floating ? { position: 'fixed', bottom: 20, right: 20, zIndex: 90, width: 'min(400px, calc(100vw - 40px))', boxShadow: '0 8px 32px #1d24331a' } : { margin: '12px 0' }),
    background: '#fff', border: '1px solid #dce2f2', borderLeft: '3px solid #112d94', borderRadius: 12,
    padding: 18, color: '#1d2433', fontFamily: 'Arial, sans-serif', fontSize: 12, lineHeight: 1.7,
  }}>
    <strong style={{ display: 'block', marginBottom: 6 }}>{state.reminder ? 'Finish the request in your wallet' : state.active}</strong>
    <p role="status" style={{ margin: 0, color: '#667086' }}>{state.reminder ?? 'This wallet action is in progress. Finish any approval in your wallet. Other approvals are paused until it completes.'}</p>
    {!state.active && state.reminder && <><button type="button" onClick={dismissWalletReminder} style={{ marginTop: 12, padding: '9px 12px', background: '#112d94', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer' }}>I’ve finished in my wallet</button><p style={{ margin: '8px 0 0', color: '#667086', fontSize: 11 }}>This clears the reminder only. It does not cancel a wallet request or send a transaction.</p></>}
  </aside>;
}
export function WalletOperationBoundary({ children }: { children: ReactNode }) {
  return <Managed.Provider value={true}>{children}<Notice floating /></Managed.Provider>;
}
export function WalletOperationNotice() { return useContext(Managed) ? null : <Notice />; }
