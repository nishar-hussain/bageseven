import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('runs pnpm smoke checks using GET only, with authenticated daemon status', async () => {
  const requests: Array<{ method: string; path: string; auth?: string }> = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method!, path: req.url!, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/healthz' ? { ok: true } : { tracks: {} }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./smoke-mumbai.mjs', import.meta.url))], {
      env: { ...process.env, DAEMON_URL: base, GATEWAY_URL: base, NEXT_PUBLIC_GATEWAY_URL: base, POLICY_URL: base, DAEMON_AUTH_TOKEN: 'smoke-test-token' },
    });
    expect(stdout).toContain('SMOKE_OK');
    expect(requests).toHaveLength(4);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    expect(requests.at(-1)).toMatchObject({ path: '/internal/mumbai/status', auth: 'Bearer smoke-test-token' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
