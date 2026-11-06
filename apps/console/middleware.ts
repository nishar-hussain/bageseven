import { NextResponse, type NextRequest } from 'next/server';
import { authSecretFromEnv, verifySessionToken } from './lib/session-crypto';

const COOKIE = 'bagseven_session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/app')) return NextResponse.next();
  if (pathname === '/app/login' || pathname.startsWith('/app/login/')) return NextResponse.next();

  const raw = req.cookies.get(COOKIE)?.value;
  let secret: string;
  try {
    secret = authSecretFromEnv(process.env);
  } catch {
    const url = req.nextUrl.clone();
    url.pathname = '/app/login';
    url.searchParams.set('error', 'misconfigured');
    return NextResponse.redirect(url);
  }

  const session = await verifySessionToken(raw, secret, 'session');
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/app/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*'],
};
