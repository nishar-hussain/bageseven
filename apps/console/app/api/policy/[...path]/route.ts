import { NextRequest, NextResponse } from 'next/server';
import { getSession, sessionIsValid } from '../../../../lib/auth';

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * BFF for mandate/policy surfaces (gateway → policy).
 * Keep allowlist tight — only what the Mandate console page needs.
 */
const ALLOWED: Array<{ method: string; match: (parts: string[]) => boolean }> = [
  { method: 'GET', match: (p) => p[0] === 'mandates' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'mandates' && p.length === 2 },
  { method: 'GET', match: (p) => p[0] === 'mandates' && p.length === 3 && p[2] === 'overview' },
];

function allowed(method: string, parts: string[]): boolean {
  return ALLOWED.some((r) => r.method === method && r.match(parts));
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const session = await getSession();
  if (!sessionIsValid(session)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }

  const { path } = await ctx.params;
  if (!allowed(req.method, path)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unknown policy route' } }, { status: 404 });
  }

  const gateway = (process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.GATEWAY_URL || 'http://127.0.0.1:4000').replace(
    /\/$/,
    '',
  );
  const suffix = path.map(encodeURIComponent).join('/');
  const url = new URL(req.url);
  const target = `${gateway}/v1/${suffix}${url.search}`;

  try {
    const res = await fetch(target, {
      method: req.method,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'GATEWAY_UNREACHABLE', message: error instanceof Error ? error.message : String(error) } },
      { status: 502 },
    );
  }
}

export const GET = proxy;
