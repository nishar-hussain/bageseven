import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { worldLoginError } from '../lib/world-login-errors';
import { POST } from '../app/api/auth/world/error/route';
afterEach(() => vi.restoreAllMocks());
describe('World phone failure diagnosis', () => {
  it('keeps the actual backend error instead of replacing it with a generic host error', () => {
    expect(worldLoginError('failed_by_host_app', 'World signature expired')).toBe('World signature expired');
  });
  it('does not tell a user to retry an action whose verification limit has been reached', () => {
    expect(worldLoginError('max_verifications_reached')).toContain('Repeating the same action will not fix it');
  });
  it('logs a recognised code and stage without proof or identity information', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = new NextRequest('http://localhost:3000/api/auth/world/error', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'bagseven_world_nonce=issued', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'generic_error', stage: 'world_app', proof: 'private-proof', name: 'private-name' }) });
    expect((await POST(req)).status).toBe(204);
    expect(JSON.stringify(log.mock.calls)).toContain('world_app');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  });
  it('rejects cross-origin reports and reports without a challenge', async () => {
    for (const headers of [{ origin: 'https://other.example', cookie: 'bagseven_world_nonce=issued' }, { origin: 'http://localhost:3000', cookie: '' }]) {
      const req = new NextRequest('http://localhost:3000/api/auth/world/error', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'generic_error' }) });
      expect((await POST(req)).status).toBe(403);
    }
  });
});
