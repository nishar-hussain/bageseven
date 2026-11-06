import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie, consumeMagicToken } from '../../../../lib/auth';

/** Magic-link recovery / invite — not the primary World login. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const next = req.nextUrl.searchParams.get('next') || '/app';
  const email = consumeMagicToken(token);
  if (!email) {
    const url = req.nextUrl.clone();
    url.pathname = '/app/login';
    url.search = 'error=expired';
    return NextResponse.redirect(url);
  }
  const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
  return attachSessionCookie(res, {
    email,
    email_verified_at: Math.floor(Date.now() / 1000),
    world_human_id: `email:${email}`,
    // Recovery is not new-user onboarding — skip the email/wallet wizard.
    onboarding_done_at: Math.floor(Date.now() / 1000),
  });
}
