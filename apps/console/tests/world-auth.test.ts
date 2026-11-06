import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/auth/world/route';
import { POST as challenge } from '../app/api/auth/world/challenge/route';
const daemon = vi.hoisted(() => vi.fn());
vi.mock('../lib/daemon-bff', () => ({ daemonJson: daemon }));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('WORLD_MOCK_PROOFS', 'false'); vi.stubEnv('AUTH_SECRET', 'unit-test-world-auth');
  vi.stubEnv('WORLD_APP_ID', 'app_test'); vi.stubEnv('WORLD_RP_ID', 'rp_test'); vi.stubEnv('WORLD_RP_SIGNING_KEY', 'server-key-not-returned');
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, cookie?: string) {
  return new NextRequest('http://localhost:3000/api/auth/world', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
describe('public World sign-in', () => {
  it('returns public configuration before login without exposing the RP signing key', async () => {
    const res = await GET(); const data = await res.json();
    expect(data).toMatchObject({ app_id: 'app_test', rp_id: 'rp_test', mock_proofs: false });
    expect(JSON.stringify(data)).not.toContain('server-key-not-returned');
  });
  it('issues a browser-bound challenge without an existing operator session', async () => {
    daemon.mockResolvedValue({ ok: true, status: 200, body: { nonce: 'nonce', sig: 'signature' } });
    const res = await challenge();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('bagseven_world_nonce=nonce');
    expect(setCookie.toLowerCase()).toContain('path=/');
    expect(daemon).toHaveBeenCalledWith('/internal/world/rp-signature', expect.objectContaining({ body: JSON.stringify({ purpose: 'login' }) }));
  });
  it.each([{ mock: true }, {}])('does not create a live session from mock or missing credentials', async (body) => {
    const res = await POST(request(body));
    expect(res.status).toBeGreaterThanOrEqual(400); expect(res.headers.get('set-cookie')).toBeNull(); expect(daemon).not.toHaveBeenCalled();
  });
  it('rejects a proof from another browser challenge', async () => {
    const res = await POST(request({ idkit_response: { nonce: 'other' } }, 'bagseven_world_nonce=nonce'));
    expect(res.status).toBe(403); expect(daemon).not.toHaveBeenCalled();
  });
  it('sets a session only after the backend verifies the World identity', async () => {
    daemon.mockResolvedValue({ ok: true, status: 200, body: { ok: true, nullifier: 'human', human_id: 'world:human' } });
    const res = await POST(request({ idkit_response: { nonce: 'nonce' } }, 'bagseven_world_nonce=nonce'));
    expect(res.status).toBe(200); expect(res.headers.get('set-cookie')).toContain('bagseven_session=');
    const data = await res.json();
    expect(data).toMatchObject({ needs_onboarding: true, returning: false });
  });
  it('skips onboarding for returning World humans', async () => {
    daemon.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, nullifier: 'human', human_id: 'world:human', returning: true },
    });
    const res = await POST(request({ idkit_response: { nonce: 'nonce' } }, 'bagseven_world_nonce=nonce'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ needs_onboarding: false, returning: true });
  });
  it('does not fabricate an identity when Agent Pass verification is unavailable', async () => {
    vi.stubEnv('WORLD_MOCK_PROOFS', 'true');
    daemon.mockResolvedValue({ ok: false, status: 404, body: {} });
    const res = await POST(request({ id_token: 'unverified-token' }));
    expect(res.status).toBe(404); expect(res.headers.get('set-cookie')).toBeNull();
  });
  it('never permits production mock login, even with the flag set', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('WORLD_MOCK_PROOFS', 'true');
    const res = await POST(request({ mock: true })); expect(res.status).toBe(403);
  });
});
