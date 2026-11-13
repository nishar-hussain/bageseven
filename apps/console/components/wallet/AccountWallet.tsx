'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
export type AccountProfile = { email: string | null; email_verified: boolean; wallet_address: string | null; holder: string; mock?: boolean; needs_onboarding?: boolean };
const Context = createContext<{ profile: AccountProfile | null; loaded: boolean; error: string; refresh: () => Promise<AccountProfile | null> } | null>(null);
export function AccountWalletProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AccountProfile | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const response = await fetch('/api/me', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok && response.status !== 401) throw Error('Your saved account could not be loaded. Retry before linking a wallet.');
      const current: AccountProfile | null = response.ok ? await response.json() : null;
      if (request === sequence.current) { setProfile(current); setError(''); }
      return current;
    } catch {
      if (request === sequence.current) setError('Your saved account could not be loaded. Retry before linking a wallet.');
      return null;
    } finally { if (request === sequence.current) setLoaded(true); }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'bagseven:account-updated') void refresh(); };
    window.addEventListener('focus', onFocus); window.addEventListener('storage', onStorage);
    return () => { invalidate(); window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage); };
  }, [refresh, invalidate]);
  return <Context.Provider value={{ profile, loaded, error, refresh }}>{children}</Context.Provider>;
}
export function useAccountWallet() {
  const context = useContext(Context);
  if (!context) throw Error('Account wallet provider is missing');
  return context;
}
export function announceAccountUpdate() {
  try { localStorage.setItem('bagseven:account-updated', String(Date.now())); } catch { /* Focus refresh remains available. */ }
}
