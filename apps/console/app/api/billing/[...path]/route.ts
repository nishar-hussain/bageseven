import { providerScopeHeaders } from '../../../../lib/provider-gas-scope';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, sessionIsValid, sessionHolder } from '../../../../lib/auth';
import { daemonFetch } from '../../../../lib/daemon-bff';

type Ctx = { params: Promise<{ path: string[] }> };

const ALLOWED: Array<{ method: string; match: (parts: string[]) => boolean }> = [
  { method: 'GET', match: p => p[0] === 'subscriptions' && p.length <= 2 },
  { method: 'POST', match: p => p[0] === 'subscriptions' && p.length === 3 && ['cancel', 'sync'].includes(p[2]!) },
  { method: 'GET', match: (p) => p[0] === 'plans' && (p.length === 1 || p.length === 2) },
  { method: 'POST', match: (p) => p[0] === 'plans' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'checkout-sessions' && (p.length === 1 || p.length === 2) },
  { method: 'POST', match: (p) => p[0] === 'checkout-sessions' && p.length === 1 },
];

function allowed(method: string, parts: string[]): boolean {
  return ALLOWED.some((r) => r.method === method && r.match(parts));
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  const { path } = await ctx.params;
  if (!allowed(req.method, path)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unknown billing route' } }, { status: 404 });
  }
  const suffix = path.map(encodeURIComponent).join('/');
  const url = new URL(req.url);
  const target = `/v1/${suffix}${url.search}`;
  const headers = new Headers();
  headers.set('x-bagseven-provider', session.world_human_id ? `world:${session.world_human_id}` : sessionHolder(session));
  for (const [name, value] of Object.entries(providerScopeHeaders(headers.get('x-bagseven-provider')!))) headers.set(name, value);
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
    headers.set('content-type', 'application/json');
  }
  try {
    // DAEMON_AUTH_TOKEN counts as sk_ for plan/session create
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
