import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ daemonJson: vi.fn() }));
vi.mock('../lib/daemon-bff', () => mock);
import { GET } from '../app/api/auth/world/route';

afterEach(() => { vi.unstubAllEnvs(); mock.daemonJson.mockReset(); });
describe('hosted World readiness', () => {
  it('uses daemon signing readiness without requiring an RP key on Vercel', async () => {
    vi.stubEnv('WORLD_APP_ID', ''); vi.stubEnv('WORLD_RP_ID', ''); vi.stubEnv('WORLD_RP_SIGNING_KEY', '');
    mock.daemonJson.mockResolvedValue({ ok: true, body: { tracks: { world: {
      app_id: 'app_live', rp_id: 'rp_live', idkit: true, signing_configured: true,
      mock_proofs: false, environment: 'production', private_key: 'never-return-this',
    } } } });
    const res = await GET(new NextRequest('https://app.example/api/auth/world'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ app_id: 'app_live', rp_id: 'rp_live', idkit: true, signing_configured: true, mock_proofs: false });
    expect(JSON.stringify(body)).not.toContain('never-return-this');
  });
  it('does not claim a disconnected signer is ready', async () => {
    mock.daemonJson.mockRejectedValue(new Error('offline'));
    const res = await GET(new NextRequest('https://app.example/api/auth/world'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'WORLD_SERVICE_UNAVAILABLE' } });
  });
  it('keeps login disabled when the daemon signing key is absent', async () => {
    mock.daemonJson.mockResolvedValue({ ok: true, body: { tracks: { world: { idkit: true, signing_configured: false } } } });
    const res = await GET(new NextRequest('https://app.example/api/auth/world'));
    expect((await res.json()).idkit).toBe(false);
  });
});
