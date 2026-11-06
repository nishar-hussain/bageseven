import { NextRequest, NextResponse } from 'next/server';
import { getSession, sessionIsValid } from '../../../../lib/auth';
import { verifiedSpendingOwner } from '../../../../lib/spending-wallet';
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
  { method: 'GET', match: (p) => p[0] === 'mandate-config' && p.length === 1 },
  { method: 'POST', match: (p) => p[0] === 'mandates' && (p.length === 1 || (p.length === 2 && p[1] === 'prepare')) },
  { method: 'POST', match: (p) => p[0] === 'mandates' && p.length === 3 && ['transaction', 'delegation', 'spawn-agent'].includes(p[2]!) },
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

  const gateway = (process.env.GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://127.0.0.1:4000').replace(
    /\/$/,
    '',
  );
  const verifiedOwner = verifiedSpendingOwner(req, session);
  const owners = [...new Set([...(verifiedOwner ? [verifiedOwner] : []), ...operatorOwnerAddresses()])];
  const ownerAllowed = (owner: string | null | undefined) => Boolean(owner && (owner.toLowerCase() === verifiedOwner || assertOwnerAllowed(owner)));
  if (owners.length === 0 && path[0] !== 'mandate-config') {
    if (req.method === 'GET' && path[0] === 'mandates' && path.length === 1) return NextResponse.json({ mandates: [] });
    return NextResponse.json(
      {
        error: {
          code: 'OPERATOR_WALLET_UNCONFIGURED',
          message: 'Verify ownership of your connected wallet to manage spending permissions',
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  // List: force owner scope to the operator wallet(s). Never forward scope=all.
  if (path.length === 1 && path[0] === 'mandates') {
    const requested = url.searchParams.get('owner_address');
    if (requested && !ownerAllowed(requested)) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'owner_address is outside your operator scope' } }, { status: 403 });
    }
    url.searchParams.set('scope', 'owner');
    url.searchParams.set('owner_address', requested && ownerAllowed(requested) ? requested : owners[0]!);
  }

  const suffix = path.map(encodeURIComponent).join('/');
  const target = `${gateway}/v1/${suffix}${url.search}`;

  try {
    let body: string | undefined;
    if (req.method === 'POST') {
      // Bind mutations BEFORE forwarding; checking a response after a write is too late.
      const origin = req.headers.get('origin');
      if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: { message: 'Cross-origin request rejected' } }, { status: 403 });
      const raw = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!raw) return NextResponse.json({ error: { message: 'Invalid request body' } }, { status: 400 });
      if (path.length <= 2) {
        if (typeof raw.owner_address !== 'string' || !ownerAllowed(raw.owner_address)) return NextResponse.json({ error: { message: 'Verify ownership of the connected wallet before creating a spending permission' } }, { status: 403 });
      } else {
        const detail = await fetch(`${gateway}/v1/mandates/${encodeURIComponent(path[1]!)}`, { headers: gatewayAuthHeaders(), cache: 'no-store' });
        if (!detail.ok) return new NextResponse(await detail.text(), { status: detail.status });
        const data = await detail.json() as { mandate?: { owner_address?: string } };
        if (!ownerAllowed(data.mandate?.owner_address)) return NextResponse.json({ error: { message: 'Mandate is outside your operator scope' } }, { status: 403 });
      }
      body = JSON.stringify(raw);
    }
    const res = await fetch(target, {
      method: req.method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(req.headers.get('idempotency-key') ? { 'idempotency-key': req.headers.get('idempotency-key')! } : {}),
        ...gatewayAuthHeaders(),
        ...sessionActorHeaders(session),
      },
      body,
      cache: 'no-store',
    });
    const text = await res.text();
    if (res.ok && path[0] === 'mandate-config') return NextResponse.json({ ...JSON.parse(text), owner_addresses: owners });
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
        if (owner && !ownerAllowed(owner)) {
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
export const POST = proxy;
