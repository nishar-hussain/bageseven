import { NextRequest, NextResponse } from 'next/server';
import {
  attachSessionCookie,
  getSession,
  mergeSessionIdentity,
  sessionIsValid,
} from '../../../../lib/auth';

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Attach an optional Whitechain/EVM wallet to the World session (onboarding or Account). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: 'Sign in with World first' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { wallet_address?: string | null; clear?: boolean };
  if (body.clear) {
    const res = NextResponse.json({ ok: true, wallet_address: null });
    return attachSessionCookie(res, mergeSessionIdentity(session, { wallet_address: null }));
  }

  const wallet = body.wallet_address?.trim() ?? '';
  if (!ADDR.test(wallet)) {
    return NextResponse.json({ error: 'Enter a valid 0x wallet address' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, wallet_address: wallet.toLowerCase() });
  return attachSessionCookie(res, mergeSessionIdentity(session, { wallet_address: wallet.toLowerCase() }));
}
