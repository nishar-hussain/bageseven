import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../app/api/auth/world/route';
import { signWorldContinuity, WORLD_CONTINUITY_COOKIE, readWorldContinuity } from '../lib/world-continuity';
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
  it('returns daemon public configuration before login without exposing the RP signing key', async () => {
    daemon.mockResolvedValueOnce({ ok: true, status: 200, body: { tracks: { world: { app_id: 'app_test', rp_id: 'rp_test', mock_proofs: false, signing_configured: true, idkit: true } } } });
    const res = await GET(new NextRequest('http://localhost:3000/api/auth/world'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(daemon).toHaveBeenCalledWith('/internal/mumbai/status');
    expect(data).toMatchObject({ app_id: 'app_test', rp_id: 'rp_test', mock_proofs: false });
    expect(JSON.stringify(data)).not.toContain('server-key-not-returned');
  });
  it('resumes a returning device from the signed World identity cookie', async () => {
    const { attachWorldIdentityCookie, WORLD_IDENTITY_COOKIE } = await import('../lib/auth');
    const seed = new NextResponse();
    attachWorldIdentityCookie(seed, '0xreturninghuman');
    const cookie = seed.cookies.get(WORLD_IDENTITY_COOKIE)?.value;
    expect(cookie).toBeTruthy();
    const res = await POST(
      new NextRequest('http://localhost:3000/api/auth/world', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `${WORLD_IDENTITY_COOKIE}=${cookie}` },
        body: JSON.stringify({ device_resume: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      returning: true,
      needs_onboarding: false,
      world_human_id: '0xreturninghuman',
    });
    expect(res.headers.get('set-cookie')).toContain('bagseven_session=');
  });
  it('issues a browser-bound challenge without an existing operator session', async () => {
    daemon.mockResolvedValue({ ok: true, status: 200, body: { nonce: 'nonce', sig: 'signature' } });
    const res = await challenge(new NextRequest('http://localhost:3000/api/auth/world/challenge', { method: 'POST' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('bagseven_world_nonce=nonce');
    expect(setCookie.toLowerCase()).toContain('path=/');
    expect(daemon).toHaveBeenCalledWith('/internal/world/rp-signature', expect.objectContaining({ body: JSON.stringify({ purpose: 'session' }) }));
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
  it('remembers a verified World session without using its per-proof nullifier as the account', async () => {
    daemon.mockResolvedValue({ ok: true, status: 200, body: { ok: true, session_id: 'session_account', nullifier: 'proof-nullifier', human_id: 'world:session:session_account' } });
    const res = await POST(request({ idkit_response: { nonce: 'nonce', session_id: 'session_account' } }, 'bagseven_world_nonce=nonce'));
    expect(res.status).toBe(200);
    expect((await res.json()).world_human_id).toBe('world:session:session_account');
    expect(res.headers.get('set-cookie')).toContain(WORLD_CONTINUITY_COOKIE);
    expect(daemon).toHaveBeenCalledWith('/internal/world/verify-idkit-session', expect.anything());
  });
  it('binds the next challenge to a signed saved session, and rejects tampering', async () => {
    const token = signWorldContinuity('session_saved');
    expect(readWorldContinuity(token)).toBe('session_saved');
    expect(readWorldContinuity(token + 'tampered')).toBeUndefined();
    daemon.mockResolvedValue({ ok: true, status: 200, body: { nonce: 'nonce', sig: 'signature' } });
    await challenge(new NextRequest('http://localhost:3000/api/auth/world/challenge', { method: 'POST', headers: { cookie: `${WORLD_CONTINUITY_COOKIE}=${token}` } }));
    expect(daemon).toHaveBeenCalledWith('/internal/world/rp-signature', expect.objectContaining({ body: JSON.stringify({ purpose: 'session', existing_session_id: 'session_saved' }) }));
  });
  it('does not accept a different World session for an existing account', async () => {
    daemon.mockResolvedValue({ ok: true, status: 200, body: { ok: true, session_id: 'session_other', human_id: 'world:session:session_other' } });
    const res = await POST(request({ idkit_response: { nonce: 'nonce', session_id: 'session_other' } }, `bagseven_world_nonce=nonce; ${WORLD_CONTINUITY_COOKIE}=${signWorldContinuity('session_saved')}`));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
  it('requires the browser nonce cookie even when the client supplies its own nonce', async () => {
    const res = await POST(request({ idkit_response: { nonce: 'nonce' }, challenge_nonce: 'nonce' }));
    expect(res.status).toBe(403); expect(daemon).not.toHaveBeenCalled();
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
