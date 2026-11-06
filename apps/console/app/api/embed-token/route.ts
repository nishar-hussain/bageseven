import { NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../lib/auth';
import { daemonJson } from '../../../lib/daemon-bff';

/** Session-gated: issue a holder-scoped embed token for the signed-in operator. */
export async function POST() {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  const holder = sessionHolder(session);
  const { ok, status, body } = await daemonJson<{ token?: string; holder?: string; expires_in?: number; error?: unknown }>(
    '/v1/access-tokens',
    { method: 'POST', body: JSON.stringify({ holder, expiresIn: 900 }) },
  );
  return NextResponse.json(body, { status: ok ? 200 : status });
}
