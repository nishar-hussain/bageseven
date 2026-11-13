import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dismissWalletReminder, getWalletOperation, withWalletOperation } from './wallet-operations.js';
beforeEach(() => { vi.stubGlobal('navigator', {}); dismissWalletReminder(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); dismissWalletReminder(); });
it('rejects a competing flow without queuing or sending its wallet request', async () => {
  let finish!: (value: string) => void;
  const first = withWalletOperation('Deploy registry', () => new Promise<string>(resolve => { finish = resolve; }));
  const send = vi.fn(async () => 'second transaction');
  await expect(withWalletOperation('Fund gas', send)).rejects.toThrow('Deploy registry');
  expect(send).not.toHaveBeenCalled();
  finish('original hash'); expect(await first).toBe('original hash');
  expect(getWalletOperation().active).toBeNull();
});
it('blocks further requests after a nested pending-wallet error until the user acknowledges it', async () => {
  const send = vi.fn(async () => { throw { cause: { code: -32002 } }; });
  await expect(withWalletOperation('Deploy', send)).rejects.toEqual({ cause: { code: -32002 } });
  expect(getWalletOperation().reminder).toContain('unfinished request');
  await expect(withWalletOperation('Retry', send)).rejects.toThrow('acknowledge');
  expect(send).toHaveBeenCalledOnce();
  dismissWalletReminder();
  const next = vi.fn(async () => 'approved');
  expect(await withWalletOperation('Explicit next click', next)).toBe('approved');
  expect(next).toHaveBeenCalledOnce();
});
it('fails closed when another same-origin tab owns the browser lock', async () => {
  const request = vi.fn(async (_name, options, action) => { expect(options).toEqual({ ifAvailable: true }); return action(null); });
  vi.stubGlobal('navigator', { locks: { request } });
  const send = vi.fn(async () => 'hash');
  await expect(withWalletOperation('Deploy', send)).rejects.toThrow('Another Bagseven tab');
  expect(send).not.toHaveBeenCalled();
});
it('does not release a live request on a timer or retry after user rejection', async () => {
  vi.useFakeTimers();
  let reject!: (error: unknown) => void;
  const first = withWalletOperation('Approval', () => new Promise((_resolve, fail) => { reject = fail; }));
  const declined = expect(first).rejects.toEqual({ code: 4001 });
  await vi.advanceTimersByTimeAsync(120000);
  expect(getWalletOperation().active).toBe('Approval');
  reject({ code: 4001 }); await declined;
  expect(getWalletOperation()).toEqual({ active: null, reminder: null });
});
