import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie, consumeMagicToken } from '../../../../lib/auth';
import { accountProfiles } from '../../../../lib/account-profiles';
import { consumeAuthChallenge } from '../../../../lib/auth-challenges';

/** Passwordless email sign-in. The wallet is linked during onboarding. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const next = req.nextUrl.searchParams.get('next') || '/app';
  const email = consumeMagicToken(token);
  if (!email || !await consumeAuthChallenge(token)) {
    const url = req.nextUrl.clone();
    url.pathname = '/app/login';
    url.search = 'error=expired';
    return NextResponse.redirect(url);
  }
  const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
  const profile = await accountProfiles().ensure(email);
  return attachSessionCookie(res, {
    email,
    email_verified_at: Math.floor(Date.now() / 1000),
    wallet_address: profile.walletAddress,
    onboarding_done_at: profile.onboardingDoneAt,
  });
}
