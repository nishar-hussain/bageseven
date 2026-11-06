import { NextRequest, NextResponse } from 'next/server';
import { daemonFetch } from '../../../../lib/daemon-bff';
import { getSession } from '../../../../lib/auth';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const suffix = path.map(encodeURIComponent).join('/');
  const url = new URL(req.url);
  const target = `/internal/${suffix}${url.search}`;

  const init: RequestInit = { method: req.method };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }
  const headers = new Headers(init.headers);
  const session = await getSession();
  if (session?.email) headers.set('x-bagseven-actor', session.email);
  init.headers = headers;

  try {
    const res = await daemonFetch(target, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
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
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
