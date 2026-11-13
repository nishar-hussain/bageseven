import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), approve: vi.fn() }));
vi.mock('../lib/auth', () => ({ getSession: mocks.session, sessionIsValid: (s: unknown) => Boolean(s), sessionHolder: (s: { email: string }) => s.email }));
vi.mock('../lib/mcp-console-consent', () => ({ mcpIssuer: () => 'https://mcp.example', mcpConsoleConsent: () => ({ requests: { get: mocks.get }, approve: mocks.approve }) }));
import { mcpConsentCsrf } from '../lib/mcp-consent-csrf';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/mcp/consent/route';
const id = 'a'.repeat(43);
const session = { email: 'owner@example.com', exp: 2000000000, email_verified_at: 1, wallet_address: '0x'+'11'.repeat(20) };
const request = (origin = 'https://console.example') => new NextRequest('https://console.example/api/mcp/consent', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: id, csrf: mcpConsentCsrf(id, session), email: 'attacker@example.com', wallet: 'attacker' }) });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(session); mocks.get.mockResolvedValue({ issuer: 'https://mcp.example' }); mocks.approve.mockResolvedValue({ issuer: 'https://mcp.example', code: 'opaque-proof' }); });
it('uses the verified console session without another email or wallet challenge', async () => {
  const response = await POST(request());
  expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('https://mcp.example/oauth/account/console?code=opaque-proof');
  expect(mocks.approve).toHaveBeenCalledWith(id, 'owner@example.com', '0x'+'11'.repeat(20));
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('rejects unverified sessions and cross-origin approvals', async () => {
  expect((await POST(request('https://attacker.example'))).status).toBe(403);
  mocks.session.mockResolvedValue({ email: 'owner@example.com' }); expect((await POST(request())).status).toBe(401);
  expect(mocks.approve).not.toHaveBeenCalled();
});
it('rejects expired requests and requests for another issuer', async () => {
  mocks.get.mockResolvedValue(undefined); expect((await POST(request())).status).toBe(400);
  mocks.get.mockResolvedValue({ issuer: 'https://attacker.example' }); expect((await POST(request())).status).toBe(400);
  expect(mocks.approve).not.toHaveBeenCalled();
});

it('accepts native no-referrer form navigation only with the session-bound CSRF proof', async () => {
  expect((await POST(request('null'))).status).toBe(303);
  const forged = new NextRequest('https://console.example/api/mcp/consent', { method: 'POST', headers: { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: id }) });
  expect((await POST(forged)).status).toBe(403);
});
it('rejects a proof rendered for another account session', async () => {
  const rendered = request('null'); mocks.session.mockResolvedValue({ ...session, email: 'another@example.com' });
  expect((await POST(rendered)).status).toBe(403); expect(mocks.approve).not.toHaveBeenCalled();
});
