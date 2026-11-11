import { providerScopeHeaders } from '../../../../lib/provider-gas-scope';
import { NextRequest, NextResponse } from 'next/server';
import { daemonFetch } from '../../../../lib/daemon-bff';
import { getSession, sessionHolder, sessionIsValid } from '../../../../lib/auth';

type Ctx = { params: Promise<{ path: string[] }> };

/** Product BFF surface — never proxy arbitrary daemon internals. */
const ALLOWED: Array<{ method: string; match: (parts: string[]) => boolean }> = [
  { method: 'GET', match: (p) => p[0] === 'mumbai' && p[1] === 'status' && p.length === 2 },
  { method: 'GET', match: (p) => p[0] === 'features' && p.length === 1 },
  { method: 'POST', match: (p) => p[0] === 'features' && p.length === 1 },
  { method: 'GET', match: (p) => p[0] === 'grants' && p[1] === 'live' && p.length === 2 },
  // Intentionally no GET /grants/:id — cross-tenant grant detail IDOR.
  { method: 'POST', match: (p) => p[0] === 'grants' && p[1] === 'mint' && p.length === 2 },
  { method: 'POST', match: (p) => p[0] === 'grants' && p[1] === 'buy-credits' && p.length === 2 },
  { method: 'POST', match: (p) => p[0] === 'grants' && p[1] === 'paid-run' && p.length === 2 },
  { method: 'POST', match: (p) => p[0] === 'grants' && p[1] === 'explain-denial' && p.length === 2 },
  {
    method: 'POST',
    match: (p) => p[0] === 'grants' && p.length === 3 && p[2] === 'cancel-renewal',
  },
];

function allowed(method: string, parts: string[]): boolean {
  return ALLOWED.some((r) => r.method === method && r.match(parts));
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }

  const { path } = await ctx.params;
  if (!allowed(req.method, path)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }, { status: 404 });
  }

  const holder = sessionHolder(session);
  const url = new URL(req.url);
  // Live grants: always scope to the signed-in operator (ignore client holder filters).
  if (req.method === 'GET' && path[0] === 'grants' && path[1] === 'live') {
    url.searchParams.set('holder', holder);
  }

  const suffix = path.map(encodeURIComponent).join('/');
  const target = `/internal/${suffix}${url.search}`;

  const headers = new Headers();
  headers.set('x-bagseven-actor', holder);
  headers.set('x-bagseven-provider', holder);
  for (const [name, value] of Object.entries(providerScopeHeaders(headers.get('x-bagseven-provider')!))) headers.set(name, value);
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
    if (
      path[0] === 'grants' &&
      (path[1] === 'mint' || path[1] === 'buy-credits' || path[1] === 'paid-run' || path[1] === 'explain-denial')
    ) {
      try {
        const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
        // Console mutations always belong to the signed-in operator.
        init.body = JSON.stringify({
          ...body,
          holder,
          ...(path[1] === 'mint' || path[1] === 'buy-credits' ? { settlement_network: 'avalanche' } : {}),
        });
      } catch {
        return NextResponse.json({ error: { message: 'Invalid request body' } }, { status: 400 });
      }
    }
    headers.set('content-type', req.headers.get('content-type') ?? 'application/json');
  }

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
