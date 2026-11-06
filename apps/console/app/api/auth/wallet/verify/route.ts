import { NextRequest, NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { getSession, sessionHolder, sessionIsValid } from '../../../../../lib/auth';
import { WALLET_CHALLENGE_COOKIE, VERIFIED_WALLET_COOKIE, readWalletClaim, spendingWalletCookieOptions,
  verifiedWalletToken, walletChallenge, walletChallengeMessage } from '../../../../../lib/spending-wallet';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: { message: 'Sign in first' } }, { status: 401 });
  const owner = req.nextUrl.searchParams.get('owner') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return NextResponse.json({ error: { message: 'Invalid wallet address' } }, { status: 400 });
  const challenge = walletChallenge(sessionHolder(session), req.nextUrl.origin, owner);
  const response = NextResponse.json({ message: challenge.message }, { headers: { 'cache-control': 'no-store' } });
  response.cookies.set(WALLET_CHALLENGE_COOKIE, challenge.token, spendingWalletCookieOptions(300));
  return response;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: { message: 'Sign in first' } }, { status: 401 });
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: { message: 'Cross-origin request rejected' } }, { status: 403 });
  const challenge = readWalletClaim(req.cookies.get(WALLET_CHALLENGE_COOKIE)?.value, 'challenge', sessionHolder(session), req.nextUrl.origin);
  if (!challenge) return NextResponse.json({ error: { message: 'Wallet verification expired. Try again.' } }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { signature?: string };
  if (!body || typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) return NextResponse.json({ error: { message: 'A wallet signature is required' } }, { status: 400 });
  const signer = await recoverMessageAddress({ message: walletChallengeMessage(challenge), signature: body.signature as `0x${string}` }).catch(() => '');
  if (signer.toLowerCase() !== challenge.owner) return NextResponse.json({ error: { message: 'Signature does not match the connected wallet' } }, { status: 403 });
  const response = NextResponse.json({ owner_address: challenge.owner });
  response.cookies.set(VERIFIED_WALLET_COOKIE, verifiedWalletToken(challenge), spendingWalletCookieOptions(8 * 3600));
  response.cookies.set(WALLET_CHALLENGE_COOKIE, '', spendingWalletCookieOptions(0));
  return response;
}
