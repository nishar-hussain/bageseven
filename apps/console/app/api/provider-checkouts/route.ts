import { NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../lib/auth';
import { consoleDatabase } from '../../../lib/account-profiles';
import { providerCheckouts } from '../../../lib/provider-overview';
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !sessionIsValid(session))
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const status = params.get('status') ?? 'ALL';
  const page = Number(params.get('page') ?? 0);
  const days = Number(params.get('days') ?? 0);
  if (
    !['ALL', 'PAID', 'PENDING', 'EXPIRED', 'FAILED', 'CANCELLED'].includes(status) ||
    ![0, 7, 30, 90].includes(days) ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 500
  )
    return NextResponse.json(
      { error: 'Invalid page or status. Narrow the status filter to browse older results.' },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await providerCheckouts(consoleDatabase(), sessionHolder(session), status, page, days),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Checkouts are temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }
}
