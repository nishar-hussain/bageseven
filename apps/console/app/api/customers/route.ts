import { NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../lib/auth';
import { consoleDatabase } from '../../../lib/account-profiles';
import { customerDirectory } from '../../../lib/provider-billing';
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? 0), search = (params.get('search') ?? '').trim();
  if (!Number.isInteger(page) || page < 0 || page > 500 || search.length > 100)
    return NextResponse.json({ error: 'Invalid page or search. Narrow your search for older results.' }, { status: 400 });
  try {
    return NextResponse.json(await customerDirectory(consoleDatabase(), sessionHolder(session), search, page), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Customers are temporarily unavailable. Please retry.' }, { status: 503 });
  }
}
