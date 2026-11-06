import { describe, expect, it } from 'vitest';
import { isCorsOriginAllowed } from './cors.js';

describe('hosted CORS origins', () => {
  const env = { NODE_ENV: 'production' };
  it('accepts HTTPS hosting domains and server clients', () => {
    for (const origin of [undefined, 'https://bagseven-preview.vercel.app', 'https://daemon.up.railway.app']) {
      expect(isCorsOriginAllowed(origin, env)).toBe(true);
    }
  });
  it('rejects suffix spoofs, opaque origins, insecure deployments and local production origins', () => {
    for (const origin of ['https://vercel.app.evil.com', 'https://fakevercel.app', 'https://daemon.railway.app.evil.com', 'http://demo.vercel.app', 'null', 'https://demo.vercel.app/path', 'https://user@demo.vercel.app', 'http://localhost:3000']) {
      expect(isCorsOriginAllowed(origin, env)).toBe(false);
    }
  });
  it('supports custom domains, whitespace, local development and explicit wildcard', () => {
    expect(isCorsOriginAllowed('https://app.cesthq.com', { ...env, NEXT_PUBLIC_CONSOLE_URL: 'https://app.cesthq.com/' })).toBe(true);
    expect(isCorsOriginAllowed('https://custom.example', { ...env, CORS_ORIGIN: ' https://other.example, https://custom.example ' })).toBe(true);
    expect(isCorsOriginAllowed('https://other.example', { ...env, NEXT_PUBLIC_CONSOLE_URL: 'invalid' })).toBe(false);
    expect(isCorsOriginAllowed('http://localhost:3000', { NODE_ENV: 'development' })).toBe(true);
    expect(isCorsOriginAllowed('https://custom.example', { ...env, CORS_ORIGIN: '*' })).toBe(true);
  });
});
