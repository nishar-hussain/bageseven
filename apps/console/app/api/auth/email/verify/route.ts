import { NextRequest, NextResponse } from 'next/server';
import {
  attachSessionCookie,
  consumeOtpChallenge,
  getSession,
  mergeSessionIdentity,
} from '../../../../../lib/auth';

/** Verify an inbox and create (or update) the email-first account session. */
export async function POST(req: NextRequest) {
  const session = await getSession();

  const body = (await req.json().catch(() => ({}))) as { code?: string; challenge?: string };
  const email = consumeOtpChallenge(body.challenge ?? '', body.code ?? '');
  if (!email) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }
  if (session?.email && session.email.toLowerCase() !== email) {
    return NextResponse.json({ error: 'Sign out before signing in with a different email. Account email changes require a billing migration.' }, { status: 409 });
  }

  const verifiedAt = Math.floor(Date.now() / 1000);
  const identity = session
    ? mergeSessionIdentity(session, {
        email,
        email_verified_at: verifiedAt,
        // A fresh inbox proof is required before a previously linked wallet can be replaced.
        wallet_rebind_verified_at: session.wallet_address ? verifiedAt : null,
      })
    : { email, email_verified_at: verifiedAt, onboarding_done_at: null };
  const res = NextResponse.json({
    ok: true,
    email,
    email_verified: true,
    holder: email,
  });
  return attachSessionCookie(res, identity);
}
