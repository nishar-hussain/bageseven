import { NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../lib/auth';

export async function GET() {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const holder = sessionHolder(session);
  return NextResponse.json({
    email: session.email ?? null,
    email_verified: Boolean(session.email_verified_at),
    email_verified_at: session.email_verified_at ?? null,
    world_human_id: session.world_human_id ?? null,
    mock: Boolean(session.mock),
    holder,
  });
}
