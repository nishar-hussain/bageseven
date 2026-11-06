import { NextRequest, NextResponse } from 'next/server';
import { clearSessionOn } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/app/login', req.nextUrl.origin), 303);
  return clearSessionOn(res);
}
