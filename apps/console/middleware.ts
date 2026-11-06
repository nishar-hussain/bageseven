import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'bagseven_session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/app')) return NextResponse.next();
  if (pathname === '/app/login' || pathname.startsWith('/app/login/')) return NextResponse.next();

  const session = req.cookies.get(COOKIE)?.value;
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
