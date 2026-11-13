import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchLoginSession } from '../lib/login-handoff';
import { appDestination } from '../lib/auth-destination';

let browser: EventTarget;
let doc: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  browser = Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval });
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('waiting sign-in page', () => {
  it('detects a session established by another tab and navigates once', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValue(Response.json({ email_verified: true, mock: false }));
    vi.stubGlobal('fetch', fetcher);
    const navigate = vi.fn();
    const stop = watchLoginSession(navigate);
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(navigate).toHaveBeenCalledOnce();
    browser.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(navigate).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
    stop();
  });
  it('rechecks on focus and stops polling when the page unmounts', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const stop = watchLoginSession(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    browser.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
    browser.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps an offline form usable and retries without treating mock identity as login', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(Response.json({ email_verified: true, mock: true })),
    );
    const navigate = vi.fn();
    const stop = watchLoginSession(navigate);
    await vi.advanceTimersByTimeAsync(6000);
    expect(navigate).not.toHaveBeenCalled();
    stop();
  });
});
it('keeps return paths inside the app and avoids authentication loops', () => {
  for (const bad of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/app/../api/auth/logout',
    '/app/login?next=/app/login',
    '/app/onboarding',
    '/application',
  ])
    expect(appDestination(bad)).toBe('/app');
  expect(appDestination('/app/builder?design=123#preview')).toBe('/app/builder?design=123#preview');
});
