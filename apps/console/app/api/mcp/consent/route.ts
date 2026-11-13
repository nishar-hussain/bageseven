import { NextRequest, NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../../lib/auth';
import { mcpConsoleConsent, mcpIssuer } from '../../../../lib/mcp-console-consent';
import { validMcpConsentCsrf } from '../../../../lib/mcp-consent-csrf';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin && origin !== 'null' && origin !== new URL(req.url).origin) return NextResponse.json({ error: 'Same-origin approval required.' }, { status: 403, headers });
  const session = await getSession();
  if (!sessionIsValid(session) || !session?.email_verified_at || !session.wallet_address) return NextResponse.json({ error: 'Verify your email and wallet first.' }, { status: 401, headers });
  const data = await req.formData(), id = data.get('request');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return NextResponse.json({ error: 'Invalid connection request.' }, { status: 400, headers });
  if (!validMcpConsentCsrf(id, session, data.get('csrf'))) return NextResponse.json({ error: 'Approval expired. Reload the authorization page and try again.' }, { status: 403, headers });
  const store = mcpConsoleConsent(), pending = await store.requests.get(id);
  if (!pending || pending.issuer !== mcpIssuer()) return NextResponse.json({ error: 'Connection expired. Start again from ChatGPT.' }, { status: 400, headers });
  try {
    const proof = await store.approve(id, sessionHolder(session), session.wallet_address);
    const callback = new URL('/oauth/account/console', proof.issuer); callback.searchParams.set('code', proof.code);
    const response = NextResponse.redirect(callback, 303); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'CONSENT_EXPIRED') return NextResponse.json({ error: 'Connection expired or already approved.' }, { status: 400, headers });
    throw error;
  }
}
