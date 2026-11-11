import { NextResponse } from 'next/server';
import {
  attachSessionCookie,
  getSession,
  mergeSessionIdentity,
  sessionIsValid,
} from '../../../../../lib/auth';

/** Finish onboarding only after the verified email and signed wallet binding are present. */
export async function POST() {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: 'Sign in with your email first' }, { status: 401 });
  }
  if (!session.email_verified_at || !session.wallet_address) {
    return NextResponse.json({ error: 'Verify your email and link a wallet before finishing setup' }, { status: 409 });
  }

  const doneAt = Math.floor(Date.now() / 1000);
  const res = NextResponse.json({
    ok: true,
    onboarding_done_at: doneAt,
    email: session.email ?? null,
    wallet_address: session.wallet_address ?? null,
  });
  return attachSessionCookie(
    res,
    mergeSessionIdentity(session, {
      onboarding_done_at: doneAt,
      mock: false,
    }),
  );
}
