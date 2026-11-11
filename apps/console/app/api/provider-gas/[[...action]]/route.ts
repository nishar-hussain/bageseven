import { providerScopeHeaders } from '../../../../lib/provider-gas-scope';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, sessionIsValid, sessionHolder } from '../../../../lib/auth';
import { daemonFetch } from '../../../../lib/daemon-bff';

async function proxy(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const parts = (await ctx.params).action ?? [];
  const action = parts[0] ?? '';
  if (parts.length > 1 || (req.method === 'GET' ? action !== '' : !['prepare', 'authorize', 'revoke', 'recovery', 'recover'].includes(action))) return NextResponse.json({ error: { message: 'Unknown provider gas action' } }, { status: 404 });
  const origin = req.headers.get('origin');
  if (req.method === 'POST' && origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: { message: 'Cross-origin request rejected' } }, { status: 403 });
  try {
    const response = await daemonFetch(`/internal/provider-gas${action ? `/${action}` : ''}`, { method: req.method,
      headers: { ...providerScopeHeaders(sessionHolder(session)), 'x-bagseven-provider': sessionHolder(session), 'content-type': 'application/json' },
      body: req.method === 'POST' ? await req.text() : undefined });
    return new NextResponse(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
  } catch { return NextResponse.json({ error: { message: 'Provider gas service is unavailable' } }, { status: 503 }); }
}
export const GET = proxy;
export const POST = proxy;
