import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const secret = 'login-handoff-test-secret';
function signedSession(onboarded = true) {
  const payload = Buffer.from(
    JSON.stringify({
      k: 'session',
      exp: Math.floor(Date.now() / 1000) + 600,
      email: 'customer@example.com',
      email_verified_at: 1,
      wallet_address: onboarded ? '0x123' : null,
      onboarding_done_at: onboarded ? 1 : null,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
afterEach(() => vi.unstubAllEnvs());
describe('email-link handoff to the original sign-in tab', () => {
  it('leaves sign-in for the intended page after another tab has authenticated', async () => {
    vi.stubEnv('AUTH_SECRET', secret);
    const response = await middleware(
      new NextRequest('http://localhost:3000/app/login?next=%2Fapp%2Fplans%3Ffilter%3Dactive', {
        headers: { cookie: `bagseven_session=${signedSession()}` },
      }),
    );
    expect(response.headers.get('location')).toBe('http://localhost:3000/app/plans?filter=active');
  });
  it('sends a newly verified account through onboarding without losing its destination', async () => {
    vi.stubEnv('AUTH_SECRET', secret);
    const response = await middleware(
      new NextRequest('http://localhost:3000/app/login?next=%2Fapp%2Fbuilder', {
        headers: { cookie: `bagseven_session=${signedSession(false)}` },
      }),
    );
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/app/onboarding?next=%2Fapp%2Fbuilder',
    );
  });
});
