import { NextResponse } from 'next/server';
import {
  attachSessionCookie,
  getSession,
  mergeSessionIdentity,
  sessionIsValid,
} from '../../../../../lib/auth';

/** Mark new-user onboarding finished (email + wallet steps are optional / skippable). */
export async function POST() {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: 'Sign in with World first' }, { status: 401 });
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
