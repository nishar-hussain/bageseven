import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ token: '', profile: null as null | { walletAddress: string; onboardingDoneAt: number } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: state.token }) }) }));
vi.mock('../lib/account-profiles', () => ({ accountProfiles: () => ({ get: async () => state.profile }) }));
import { encodeSession, getSession } from '../lib/auth';
afterEach(() => { vi.unstubAllEnvs(); state.profile = null; });
describe('durable account session hydration', () => {
  it('restores wallet and onboarding for a fresh email-only login', async () => {
    vi.stubEnv('AUTH_SECRET', 'profile-test-secret');
    state.token = encodeSession({ email: 'alice@example.com', email_verified_at: 1 });
    state.profile = { walletAddress: `0x${'11'.repeat(20)}`, onboardingDoneAt: 123 };
    expect(await getSession()).toMatchObject({ wallet_address: state.profile.walletAddress, onboarding_done_at: 123 });
  });
  it('uses current persisted authority instead of a stale wallet cookie', async () => {
    vi.stubEnv('AUTH_SECRET', 'profile-test-secret');
    state.token = encodeSession({ email: 'alice@example.com', wallet_address: `0x${'22'.repeat(20)}` });
    state.profile = { walletAddress: `0x${'33'.repeat(20)}`, onboardingDoneAt: 123 };
    expect((await getSession())?.wallet_address).toBe(state.profile.walletAddress);
  });
  it('does not silently import an old cookie wallet as durable authority', async () => {
    vi.stubEnv('AUTH_SECRET', 'profile-test-secret');
    state.token = encodeSession({ email: 'alice@example.com', wallet_address: `0x${'22'.repeat(20)}` });
    expect((await getSession())?.wallet_address).toBeNull();
  });
});
