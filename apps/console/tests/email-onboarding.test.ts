import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), attachSessionCookie: vi.fn((response, _identity) => response),
  ensure: vi.fn(), sendNotify: vi.fn(), consume: vi.fn(),
}));
vi.mock('../lib/auth', () => ({
  getSession: mocks.getSession, attachSessionCookie: mocks.attachSessionCookie,
  consumeOtpChallenge: () => 'buyer@example.com',
  mergeSessionIdentity: (session: object, patch: object) => ({ ...session, ...patch }),
  generateOtpCode: () => '123456', issueOtpChallenge: () => 'otp-challenge', issueMagicToken: () => 'magic-token', isAllowedEmail: () => true,
}));
vi.mock('../lib/account-profiles', () => ({ accountProfiles: () => ({ ensure: mocks.ensure }) }));
vi.mock('../lib/auth-challenges', () => ({ attemptAuthChallenge: async () => true, consumeAuthChallenge: mocks.consume, saveAuthChallenge: async () => {}, claimAuthRate: async () => true }));
vi.mock('@bagseven/notify', () => ({ sendNotify: mocks.sendNotify }));
import { POST as verify } from '../app/api/auth/email/verify/route';
import { POST as start } from '../app/api/auth/email/start/route';
import { POST as magic } from '../app/api/auth/magic/route';
beforeEach(() => {
  vi.clearAllMocks(); mocks.getSession.mockResolvedValue(null); mocks.consume.mockResolvedValue(true);
  mocks.ensure.mockResolvedValue({ walletAddress: '0x' + '11'.repeat(20), onboardingDoneAt: 1 });
  mocks.sendNotify.mockResolvedValue({ ok: true, skipped: 'Not configured' });
});
afterEach(() => vi.unstubAllEnvs());
const request = (body: object) => new NextRequest('http://localhost:3000/api/auth/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
it('hydrates the saved wallet on OTP sign-in and records the fresh inbox proof', async () => {
  expect((await verify(request({ code: '123456', challenge: 'challenge' }))).status).toBe(200);
  expect(mocks.attachSessionCookie.mock.calls[0]![1]).toMatchObject({ wallet_address: '0x' + '11'.repeat(20), wallet_rebind_verified_at: expect.any(Number), onboarding_done_at: 1 });
});
it('does not manufacture a wallet binding for a new email account', async () => {
  mocks.ensure.mockResolvedValue({ walletAddress: null, onboardingDoneAt: null });
  await verify(request({ code: '123456', challenge: 'challenge' }));
  expect(mocks.attachSessionCookie.mock.calls[0]![1]).toMatchObject({ wallet_address: null, wallet_rebind_verified_at: null, onboarding_done_at: null });
});
it('rejects switching the session to a different inbox and reused codes', async () => {
  mocks.getSession.mockResolvedValue({ email: 'another@example.com' });
  expect((await verify(request({ code: '123456', challenge: 'challenge' }))).status).toBe(409);
  mocks.getSession.mockResolvedValue(null); mocks.consume.mockResolvedValue(false);
  expect((await verify(request({ code: '123456', challenge: 'challenge' }))).status).toBe(400);
  expect(mocks.attachSessionCookie).not.toHaveBeenCalled();
});
it('does not bypass inbox ownership when local public-Fuji email delivery is unavailable', async () => {
  vi.stubEnv('DEV_MODE', 'false'); vi.stubEnv('NODE_ENV', 'development');
  for (const handler of [start, magic]) {
    const response = await handler(request({ email: 'buyer@example.com' }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('dev_hint');
  }
});
it('keeps preview codes restricted to explicitly configured development mode', async () => {
  vi.stubEnv('DEV_MODE', 'true'); vi.stubEnv('NODE_ENV', 'development');
  expect((await start(request({ email: 'buyer@example.com' }))).status).toBe(200);
  vi.stubEnv('NODE_ENV', 'production');
  expect((await start(request({ email: 'buyer@example.com' }))).status).toBe(503);
});
