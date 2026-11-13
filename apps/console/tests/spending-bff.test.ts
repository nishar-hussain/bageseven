import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/policy/[...path]/route';
import { walletChallenge, verifiedWalletToken, VERIFIED_WALLET_COOKIE } from '../lib/spending-wallet';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), sessionIsValid: vi.fn(), sessionHolder: () => 'account:owner' }));
vi.mock('../lib/auth', () => auth);
const owner = '0x1111111111111111111111111111111111111111';
const foreign = '0x2222222222222222222222222222222222222222';
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
  vi.stubEnv('DAEMON_OWNER_ADDRESS', owner); vi.stubEnv('DAEMON_OWNER_KEY', '');
  vi.stubEnv('AVALANCHE_PAY_TO', ''); vi.stubEnv('OPERATOR_WALLET', '');
  auth.getSession.mockResolvedValue({ email: 'owner', mock: false }); auth.sessionIsValid.mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request(path: string[], body: unknown, origin = 'http://localhost:3000') {
  return POST(new NextRequest(`http://localhost:3000/api/policy/${path.join('/')}`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ path }) });
}
describe('spending management session and owner scope', () => {
  it('allows the verified connected wallet without adding it to server configuration', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-spending-secret');
    const { claim } = walletChallenge('account:owner', 'http://localhost:3000', foreign);
    const cookie = `${VERIFIED_WALLET_COOKIE}=${verifiedWalletToken(claim)}`;
    fetcher.mockResolvedValue(new Response(JSON.stringify({ mandate_id: 'mine' })));
    const response = await POST(new NextRequest('http://localhost:3000/api/policy/mandates', { method: 'POST',
      headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ owner_address: foreign, signature: 'signed' }) }), { params: Promise.resolve({ path: ['mandates'] }) });
    expect(response.status).toBe(200);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ mandates: [] })));
    await GET(new NextRequest('http://localhost:3000/api/policy/mandates', { headers: { cookie } }), { params: Promise.resolve({ path: ['mandates'] }) });
    expect(fetcher.mock.calls.at(-1)![0]).toContain(`owner_address=${foreign}`);
  });
  it('does not treat an unverified profile wallet as spending ownership', async () => {
    auth.getSession.mockResolvedValue({ email: 'owner', wallet_address: foreign });
    expect((await request(['mandates'], { owner_address: foreign })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires sign-in for every mutation', async () => {
    auth.sessionIsValid.mockReturnValue(false);
    expect((await request(['mandates'], { owner_address: owner })).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects creation for another owner and cross-origin writes before forwarding', async () => {
    expect((await request(['mandates'], { owner_address: foreign })).status).toBe(403);
    expect((await request(['mandates'], { owner_address: owner }, 'https://another.example')).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks ownership before funding, withdrawing, revoking, or delegating', async () => {
    for (const action of ['transaction', 'delegation', 'spawn-agent']) {
      fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({ mandate: { owner_address: foreign } })));
      expect((await request(['mandates', 'foreign', action], { action: 'revoke' })).status).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![1].method).toBeUndefined();
    }
  });
  it('forwards an authorized signed creation and adds only public owner configuration', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ mandate_id: 'new' })));
    expect((await request(['mandates'], { owner_address: owner, signature: 'signed' })).status).toBe(200);
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ owner_address: owner, signature: 'signed' }));
    fetcher.mockResolvedValue(new Response(JSON.stringify({ chain_id: 43113, token: foreign })));
    const config = await GET(new NextRequest('http://localhost:3000/api/policy/mandate-config'), { params: Promise.resolve({ path: ['mandate-config'] }) });
    expect(await config.json()).toMatchObject({ chain_id: 43113, owner_addresses: [owner] });
  });
});
