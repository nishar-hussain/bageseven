import { expect, it } from 'vitest';
import { accountWalletState } from '../lib/account-wallet-state';
it('distinguishes loading, disconnect, reconnect, same account and deliberate replacement', () => {
  expect(accountWalletState({ loaded: false, connected: '0xABC' })).toBe('loading');
  expect(accountWalletState({ loaded: true, failed: true, connected: '0xABC' })).toBe('unavailable');
  expect(accountWalletState({ loaded: true })).toBe('connect');
  expect(accountWalletState({ loaded: true, linked: '0xABC' })).toBe('reconnect');
  expect(accountWalletState({ loaded: true, connected: '0xABC' })).toBe('unlinked');
  expect(accountWalletState({ loaded: true, linked: '0xabc', connected: '0xABC' })).toBe('verified');
  expect(accountWalletState({ loaded: true, linked: '0xabc', connected: '0xDEF' })).toBe('different');
});
