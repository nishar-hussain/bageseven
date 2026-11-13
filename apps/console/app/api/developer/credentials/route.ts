import { NextRequest, NextResponse } from 'next/server';
import { ProviderApiKeys } from '@bagseven/db';
import { getSession, sessionHolder, sessionIsValid } from '../../../../lib/auth';
import { consoleDatabase } from '../../../../lib/account-profiles';
import { EMBED_COMPONENTS } from '../../../../lib/bagseven-sdk-components';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
async function owner() {
  const session = await getSession();
  return sessionIsValid(session) && session?.email_verified_at && session.wallet_address ? sessionHolder(session) : null;
}
function sameOrigin(req: NextRequest) { return req.headers.get('origin') === new URL(req.url).origin; }
export async function GET() {
  const provider = await owner();
  if (!provider) return response({ error: { message: 'Verify your email and wallet to manage API keys.' } }, 401);
  const keys = await new ProviderApiKeys(consoleDatabase()).list(provider);
  return response({ keys, components: EMBED_COMPONENTS.map(c => ({ id: c.id, label: c.label, blurb: c.blurb })), public_api_path: '/api/public', embed_base_path: '/embed' });
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return response({ error: { message: 'Same-origin request required.' } }, 403);
  const provider = await owner();
  if (!provider) return response({ error: { message: 'Verify your email and wallet to manage API keys.' } }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || !['sk','pk'].includes(body.kind) || !Number.isInteger(body.days) || body.days < 1 || body.days > 365)
    return response({ error: { message: 'Supply a name, key type and expiry of 1–365 days.' } }, 400);
  try { return response(await new ProviderApiKeys(consoleDatabase()).create(provider, body.name, body.kind, body.days), 201); }
  catch (error) {
    if (error instanceof Error && error.message === 'API_KEY_RATE_LIMIT') return response({ error: { message: 'Key creation limit reached. Try again in one hour.' } }, 429);
    if (error instanceof Error && error.message.startsWith('API_KEY_LIMIT')) return response({ error: { message: 'You have 10 active keys. Revoke an unused key first.' } }, 409);
    throw error;
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return response({ error: { message: 'Same-origin request required.' } }, 403);
  const provider = await owner();
  if (!provider) return response({ error: { message: 'Verify your email and wallet to manage API keys.' } }, 401);
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return response({ error: { message: 'Invalid key ID.' } }, 400);
  if (!await new ProviderApiKeys(consoleDatabase()).revoke(provider, id)) return response({ error: { message: 'Key not found.' } }, 404);
  return response({ revoked: true });
}
