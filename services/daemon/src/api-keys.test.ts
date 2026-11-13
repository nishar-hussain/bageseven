import { describe, expect, it } from 'vitest';
import { authenticateRequest, issueEmbedToken, verifyEmbedToken } from './api-keys.js';
import { isPublicEntitlementPath } from './public-entitlements.js';

const env = {
  DAEMON_AUTH_TOKEN: 'sk_daemon',
  BAGSEVEN_SECRET_KEY: 'sk_product',
  BAGSEVEN_PUBLISHABLE_KEY: 'pk_product',
};

describe('api keys', () => {
  it('accepts pk, sk, daemon token, and embed tokens', () => {
    expect(authenticateRequest('Bearer pk_product', env).kind).toBe('pk');
    expect(authenticateRequest('Bearer sk_product', env).kind).toBe('sk');
    expect(authenticateRequest('Bearer sk_daemon', env).kind).toBe('sk');
    const token = issueEmbedToken('human@x.com', env, 60);
    const principal = authenticateRequest(`Bearer ${token}`, env);
    expect(principal).toMatchObject({ kind: 'embed', holder: 'human@x.com' });
    expect(verifyEmbedToken(token, env).holder).toBe('human@x.com');
  });

  it('rejects missing and unknown keys', () => {
    expect(() => authenticateRequest(undefined, env)).toThrow(/missing API key/);
    expect(() => authenticateRequest('Bearer nope', env)).toThrow(/unknown API key/);
  });

  it('lets pk/sk/embed routes skip the daemon Bearer hook', () => {
    expect(isPublicEntitlementPath('/v1/check?feature=ocr')).toBe(true);
    expect(isPublicEntitlementPath('/v1/usage/consume')).toBe(true);
    expect(isPublicEntitlementPath('/internal/grants/mint')).toBe(false);
  });
});

it('binds the trusted billing contact to the signed customer token', () => {
  const token = issueEmbedToken('customer-123', env, 60, 'buyer@example.com');
  expect(authenticateRequest(`Bearer ${token}`, env)).toMatchObject({ kind: 'embed', holder: 'customer-123', billingEmail: 'buyer@example.com' });
});

it('does not let public browser keys read private customer access', async () => {
  const { assertCanRead } = await import('./api-keys.js');
  expect(() => assertCanRead(authenticateRequest('Bearer pk_product', env), 'customer')).toThrow(/Customer access token required/);
});
