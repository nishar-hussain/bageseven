import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mountMcpOAuth } from './mcp-oauth-as';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  mountMcpOAuth(app);
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not listen');
  base = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('BAGSEVEN_MCP_PUBLIC_URL', base);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
function qr(body: unknown, overrides: Record<string, string> = {}) {
  return fetch(`${base}/oauth/world/qr`, { method: 'POST', headers: { origin: base, cookie: 'bagseven_oauth_world_nonce=issued', 'content-type': 'application/json', ...overrides }, body: JSON.stringify(body) });
}
describe('World OAuth desktop QR', () => {
  it('renders a real scannable PNG with a quiet margin and disables caching', async () => {
    const result = await qr({ nonce: 'issued', uri: 'https://world.org/verify?t=wld&i=qr-test-request' });
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('image/png');
    expect(result.headers.get('cache-control')).toBe('no-store');
    const png = Buffer.from(await result.arrayBuffer());
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(320);
    expect(png.readUInt32BE(20)).toBe(320);
    expect(png.length).toBeGreaterThan(500);
  });
  it('requires the same browser origin and matching verification nonce', async () => {
    const body = { nonce: 'issued', uri: 'https://world.org/verify?t=wld' };
    expect((await qr(body, { origin: 'https://other.example' })).status).toBe(403);
    expect((await qr(body, { cookie: '' })).status).toBe(403);
    expect((await qr({ ...body, nonce: 'different' })).status).toBe(403);
  });
  it.each(['https://other.example/verify', 'javascript:alert(1)', 'https://world.org/other', 'https://world.org.evil.example/verify'])('rejects a non-World connector: %s', async uri => {
    expect((await qr({ nonce: 'issued', uri })).status).toBe(400);
  });
  it('keeps a mobile deep link alongside the desktop QR image', async () => {
    const params = new URLSearchParams({ client_id: 'qr-test', redirect_uri: 'http://localhost:9999/callback', response_type: 'code' });
    const result = await fetch(`${base}/oauth/authorize?${params}`);
    expect(result.status).toBe(200);
    const page = await result.text();
    expect(page).toContain('id="world-qr"');
    expect(page).toContain('id="world-link"');
    expect(page).toContain("uri: request.connectorURI");
  });
});
