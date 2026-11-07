import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/provider-gas/[[...action]]/route';
import { verifyProviderScope } from '../../../packages/onchain/src/provider-gas';
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), sessionIsValid: vi.fn(), daemonFetch: vi.fn() }));
vi.mock('../lib/auth', () => ({ ...mocks, sessionHolder: () => 'world:human' }));
vi.mock('../lib/daemon-bff', () => ({ daemonFetch: mocks.daemonFetch }));
const env = { NODE_ENV: 'test' as const, PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32) };
beforeEach(() => {
  vi.stubEnv('PROVIDER_GAS_ENCRYPTION_KEY', env.PROVIDER_GAS_ENCRYPTION_KEY);
  vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ world_human_id: 'human' }); mocks.sessionIsValid.mockReturnValue(true);
  mocks.daemonFetch.mockImplementation(async () => new Response(JSON.stringify({ configured: false })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const context = (action?: string) => ({ params: Promise.resolve({ action: action ? [action] : [] }) });
describe('provider gas session scope', () => {
  it('signs the authenticated provider identity instead of accepting browser-selected scope', async () => {
    const req = new NextRequest('http://localhost:3000/api/provider-gas/prepare', { method: 'POST', headers: { 'x-bagseven-provider': 'victim', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'victim' }) });
    expect((await POST(req, context('prepare'))).status).toBe(200);
    const headers = mocks.daemonFetch.mock.calls[0]![1].headers;
    expect(headers['x-bagseven-provider']).toBe('world:human');
    expect(verifyProviderScope(headers['x-bagseven-provider-scope'], 'world:human', env)).toBe(true);
    expect(verifyProviderScope(headers['x-bagseven-provider-scope'], 'victim', env)).toBe(false);
    expect(verifyProviderScope('public-service-bearer', 'world:human', env)).toBe(false);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 121000);
    expect(verifyProviderScope(headers['x-bagseven-provider-scope'], 'world:human', env)).toBe(false);
  });
  it('requires sign-in and rejects cross-origin or unknown mutations', async () => {
    mocks.sessionIsValid.mockReturnValue(false);
    expect((await GET(new NextRequest('http://localhost:3000/api/provider-gas'), context())).status).toBe(401);
    mocks.sessionIsValid.mockReturnValue(true);
    expect((await POST(new NextRequest('http://localhost:3000/api/provider-gas/revoke', { method: 'POST', headers: { origin: 'https://another.example' }, body: '{}' }), context('revoke'))).status).toBe(403);
    expect((await POST(new NextRequest('http://localhost:3000/api/provider-gas/export-key', { method: 'POST', body: '{}' }), context('export-key'))).status).toBe(404);
    expect(mocks.daemonFetch).not.toHaveBeenCalled();
  });
});
