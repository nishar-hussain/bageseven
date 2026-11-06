import { NextRequest, NextResponse } from 'next/server';
import { getSession, sessionIsValid } from '../../../../lib/auth';
import {
  assertOwnerAllowed,
  gatewayAuthHeaders,
  operatorOwnerAddresses,
  sessionActorHeaders,
} from '../../../../lib/operator-scope';

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * BFF for mandate/policy surfaces (gateway → policy).
 * Session required + tenant bind: never scope=all, never arbitrary owner_address.
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
  if (!sessionIsValid(session) || !session) {
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
  const owners = operatorOwnerAddresses();
  if (owners.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'OPERATOR_WALLET_UNCONFIGURED',
          message: 'Set DAEMON_OWNER_KEY or DAEMON_OWNER_ADDRESS so mandate access can be tenant-scoped',
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  // List: force owner scope to the operator wallet(s). Never forward scope=all.
  if (path.length === 1 && path[0] === 'mandates') {
    const requested = url.searchParams.get('owner_address');
    if (requested && !assertOwnerAllowed(requested)) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'owner_address is outside your operator scope' } }, { status: 403 });
    }
    url.searchParams.set('scope', 'owner');
    url.searchParams.set('owner_address', requested && assertOwnerAllowed(requested) ? requested : owners[0]!);
  }

  const suffix = path.map(encodeURIComponent).join('/');
  const target = `${gateway}/v1/${suffix}${url.search}`;

  try {
    const res = await fetch(target, {
      method: req.method,
      headers: {
        accept: 'application/json',
        ...gatewayAuthHeaders(),
        ...sessionActorHeaders(session),
      },
      cache: 'no-store',
    });
    const text = await res.text();
    // Mandate detail / overview: bind owner after fetch (policy has no session).
    if (res.ok && path[0] === 'mandates' && path.length >= 2) {
      try {
        const json = JSON.parse(text) as {
          mandate?: { owner_address?: string };
          terms?: { owner_address?: string };
          owner_address?: string;
        };
        const owner =
          json.mandate?.owner_address || json.terms?.owner_address || json.owner_address || null;
        if (owner && !assertOwnerAllowed(owner)) {
          return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Mandate is outside your operator scope' } }, { status: 403 });
        }
      } catch {
        /* non-JSON — fall through */
      }
    }
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
