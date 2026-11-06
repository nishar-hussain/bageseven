import { NextRequest, NextResponse } from 'next/server';
import {
  attachSessionCookie,
  consumeOtpChallenge,
  getSession,
  mergeSessionIdentity,
  sessionIsValid,
} from '../../../../../lib/auth';

/** Verify OTP and merge verified email into the World session. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: 'Sign in with World first' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { code?: string; challenge?: string };
  const email = consumeOtpChallenge(body.challenge ?? '', body.code ?? '');
  if (!email) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }

  const res = NextResponse.json({
    ok: true,
    email,
    email_verified: true,
    world_human_id: session.world_human_id,
    holder: email,
  });
  return attachSessionCookie(
    res,
    mergeSessionIdentity(session, {
      email,
      email_verified_at: Math.floor(Date.now() / 1000),
    }),
  );
}
