import { NextResponse } from 'next/server';
import { getSession, needsOnboarding, sessionHolder, sessionIsValid } from '../../../lib/auth';
import { operatorOwnerAddresses } from '../../../lib/operator-scope';

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
    wallet_address: session.wallet_address ?? null,
    onboarding_done_at: session.onboarding_done_at ?? null,
    needs_onboarding: needsOnboarding(session),
    mock: Boolean(session.mock),
    holder,
    operator_wallets: operatorOwnerAddresses(),
  });
}
