import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeOtpChallenge, issueOtpChallenge } from '../lib/auth';

beforeEach(() => vi.stubEnv('AUTH_SECRET', 'email-challenge-test-secret'));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('email verification challenge', () => {
  it('never includes the emailed code in the browser-readable payload', () => {
    const challenge = issueOtpChallenge('Customer@example.com', '346821');
    const payload = Buffer.from(challenge.split('.')[0]!, 'base64url').toString();
    expect(payload).not.toContain('346821');
    expect(consumeOtpChallenge(challenge, '346821')).toBe('customer@example.com');
    expect(consumeOtpChallenge(challenge, '346822')).toBeNull();
  });

  it('rejects tampering and expiry', () => {
    const challenge = issueOtpChallenge('customer@example.com', '346821');
    expect(consumeOtpChallenge(`${challenge}tampered`, '346821')).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 601_000);
    expect(consumeOtpChallenge(challenge, '346821')).toBeNull();
  });
});
