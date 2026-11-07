import { afterEach, describe, expect, it, vi } from 'vitest';
import { daemonHttpProxy } from './daemon-http-proxy';
import type { Request, Response } from 'express';

afterEach(() => vi.restoreAllMocks());
const response = () => {
  const res = { status: vi.fn(), setHeader: vi.fn(), end: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
describe('embedded daemon HTTP routing', () => {
  it('rejects non-local proxy targets', () => {
    expect(() => daemonHttpProxy('https://example.com')).toThrow('local HTTP origin');
    expect(() => daemonHttpProxy('http://localhost/path')).toThrow('local HTTP origin');
  });
  it('preserves daemon rejection without adding service credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new globalThis.Response('denied', { status: 401 }));
    const res = response();
    await daemonHttpProxy('http://127.0.0.1:4001')({ path: '/internal/grants/live', originalUrl: '/internal/grants/live', method: 'GET', headers: {} } as Request, res as unknown as Response, vi.fn());
    expect(new Headers(fetch.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.end).toHaveBeenCalledWith(Buffer.from('denied'));
  });
  it('forwards authenticated JSON and provider scope, preserving query parameters', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new globalThis.Response('{}'));
    const res = response();
    await daemonHttpProxy('http://127.0.0.1:4001')({ path: '/v1/plans', originalUrl: '/v1/plans?active=true', method: 'POST', headers: { authorization: 'Bearer test', 'x-bagseven-provider-scope': 'scope', host: 'public.example' }, body: { credits: 4 } } as unknown as Request, res as unknown as Response, vi.fn());
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:4001/v1/plans?active=true');
    expect(options?.body).toBe('{"credits":4}');
    const headers = new Headers(options?.headers);
    expect(headers.get('authorization')).toBe('Bearer test');
    expect(headers.get('x-bagseven-provider-scope')).toBe('scope');
    expect(headers.has('host')).toBe(false);
    expect(options?.redirect).toBe('manual');
  });
});
