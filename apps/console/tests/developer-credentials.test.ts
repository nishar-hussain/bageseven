import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock('../lib/auth', () => ({ getSession: mocks.session, sessionIsValid: (session: unknown) => Boolean(session), sessionHolder: (session: { email: string }) => session.email }));
vi.mock('../lib/account-profiles', () => ({ consoleDatabase: () => ({}) }));
vi.mock('@bagseven/db', () => ({ ProviderApiKeys: class { list = mocks.list; create = mocks.create; revoke = mocks.revoke; } }));
import { GET, POST, DELETE } from '../app/api/developer/credentials/route';
import { NextRequest } from 'next/server';
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ email: 'provider@example.com', email_verified_at: 1, wallet_address: '0x123' }); mocks.list.mockResolvedValue([]); });
it('never returns deployment secrets or reconstructible secret keys on list', async () => {
  vi.stubEnv('BAGSEVEN_SECRET_KEY', 'server-secret-never-display'); vi.stubEnv('DAEMON_AUTH_TOKEN', 'internal-secret');
  try {
    const response = await GET(), body = await response.json();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.keys).toEqual([]); expect(body).not.toHaveProperty('secret_key');
    expect(JSON.stringify(body)).not.toContain('server-secret'); expect(JSON.stringify(body)).not.toContain('internal-secret');
    expect(mocks.list).toHaveBeenCalledWith('provider@example.com');
  } finally { vi.unstubAllEnvs(); }
});
it('requires verified email and wallet even for metadata', async () => {
  mocks.session.mockResolvedValue({ email: 'provider@example.com' });
  expect((await GET()).status).toBe(401); expect(mocks.list).not.toHaveBeenCalled();
});
it('rejects cross-origin key creation and revocation', async () => {
  const headers = { origin: 'https://attacker.example', 'content-type': 'application/json' };
  expect((await POST(new NextRequest('https://console.example/api/developer/credentials', { method: 'POST', headers, body: JSON.stringify({ name: 'bad', kind: 'sk', days: 90 }) }))).status).toBe(403);
  expect((await DELETE(new NextRequest('https://console.example/api/developer/credentials?id=anything', { method: 'DELETE', headers }))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
});
it('binds creation and deletion to the session rather than a browser-supplied owner', async () => {
  mocks.create.mockResolvedValue({ key: 'new-one-time-secret', record: { id: 'key-id' } }); mocks.revoke.mockResolvedValue(true);
  const headers = { origin: 'https://console.example', 'content-type': 'application/json' };
  const created = await POST(new NextRequest('https://console.example/api/developer/credentials', { method: 'POST', headers, body: JSON.stringify({ name: 'Backend', kind: 'sk', days: 30, provider: 'someone-else' }) }));
  expect(created.status).toBe(201); expect(mocks.create).toHaveBeenCalledWith('provider@example.com', 'Backend', 'sk', 30);
  expect((await GET()).status).toBe(200); expect(JSON.stringify(await (await GET()).json())).not.toContain('new-one-time-secret');
  const id = '11111111-1111-4111-8111-111111111111';
  expect((await DELETE(new NextRequest('https://console.example/api/developer/credentials?id=' + id, { method: 'DELETE', headers }))).status).toBe(200);
  expect(mocks.revoke).toHaveBeenCalledWith('provider@example.com', id);
});
