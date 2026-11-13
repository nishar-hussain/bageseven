import { NextResponse, type NextRequest } from 'next/server';
import { authSecretFromEnv, sessionNeedsOnboarding, verifySessionToken } from './lib/session-crypto';

import { appDestination } from './lib/auth-destination';

const COOKIE = 'bagseven_session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/app')) return NextResponse.next();
  const onLogin = pathname === '/app/login' || pathname.startsWith('/app/login/');

  const raw = req.cookies.get(COOKIE)?.value;
  let secret: string;
  try {
    secret = authSecretFromEnv(process.env);
  } catch {
    if (onLogin) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/app/login';
    url.searchParams.set('error', 'misconfigured');
    return NextResponse.redirect(url);
  }

  const session = await verifySessionToken(raw, secret, 'session');
  if (!session || session.mock) {
    if (onLogin) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/app/login';
    url.search = '';
    url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (onLogin) {
    const destination = appDestination(req.nextUrl.searchParams.get('next'));
    const url = new URL(
      sessionNeedsOnboarding(session) ? '/app/onboarding' : destination,
      req.nextUrl.origin,
    );
    if (sessionNeedsOnboarding(session)) url.searchParams.set('next', destination);
    return NextResponse.redirect(url);
  }

  const onOnboarding = pathname === '/app/onboarding' || pathname.startsWith('/app/onboarding/');
  if (sessionNeedsOnboarding(session) && !onOnboarding) {
    const url = req.nextUrl.clone();
    url.pathname = '/app/onboarding';
    url.search = '';
    url.searchParams.set('next', appDestination(pathname + req.nextUrl.search));
    return NextResponse.redirect(url);
  }
  if (!sessionNeedsOnboarding(session) && onOnboarding) {
    return NextResponse.redirect(
      new URL(appDestination(req.nextUrl.searchParams.get('next')), req.nextUrl.origin),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*'],
};
