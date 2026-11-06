import { NextRequest, NextResponse } from 'next/server';
import { daemonFetch } from '../../../../lib/daemon-bff';

type Ctx = { params: Promise<{ path: string[] }> };

const ALLOWED: Array<{ method: string; match: (parts: string[]) => boolean }> = [
  { method: 'GET', match: (p) => p[0] === 'check' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'entitlements' && p.length === 1 },
  { method: 'POST', match: (p) => p[0] === 'usage' && p[1] === 'consume' && p.length === 2 },
  { method: 'POST', match: (p) => p[0] === 'credits' && p.length === 1 },
  { method: 'POST', match: (p) => p[0] === 'access-tokens' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'plans' && (p.length === 1 || p.length === 2) },
  { method: 'POST', match: (p) => p[0] === 'plans' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'checkout-sessions' && (p.length === 1 || p.length === 2) },
  { method: 'POST', match: (p) => p[0] === 'checkout-sessions' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'public' && p[1] === 'checkout' && p.length === 3 },
  { method: 'POST', match: (p) => p[0] === 'public' && p[1] === 'checkout' && p.length === 4 && p[3] === 'confirm' },
];

function allowed(method: string, parts: string[]): boolean {
  return ALLOWED.some((r) => r.method === method && r.match(parts));
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  if (!allowed(req.method, path)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unknown public API route' } }, { status: 404 });
  }

  const suffix = path.map(encodeURIComponent).join('/');
  const url = new URL(req.url);
  const target = `/v1/${suffix}${url.search}`;

  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
    headers.set('content-type', req.headers.get('content-type') ?? 'application/json');
  }

  try {
    const res = await daemonFetch(target, { ...init, skipDaemonAuth: true });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
        'access-control-allow-origin': '*',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'DAEMON_UNREACHABLE', message: error instanceof Error ? error.message : String(error) } },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
  });
}
