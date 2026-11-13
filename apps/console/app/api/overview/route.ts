import { NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../lib/auth';
import { consoleDatabase } from '../../../lib/account-profiles';
import { providerOverview } from '../../../lib/provider-overview';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !sessionIsValid(session))
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const days = Number(new URL(request.url).searchParams.get('days') ?? 30);
  if (![7, 30, 90].includes(days))
    return NextResponse.json({ error: 'Choose a 7, 30 or 90 day period.' }, { status: 400 });
  try {
    return NextResponse.json(await providerOverview(consoleDatabase(), sessionHolder(session), days), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Provider activity is unavailable. Your data has not been replaced with sample values.' },
      { status: 503 },
    );
  }
}
