import { NextRequest, NextResponse } from 'next/server';
import { accountProfiles } from '../../../../../lib/account-profiles';
import { consumeAuthChallenge, saveAuthChallenge } from '../../../../../lib/auth-challenges';
import { recoverMessageAddress } from 'viem';
import { attachSessionCookie, getSession, mergeSessionIdentity, sessionHolder, sessionIsValid } from '../../../../../lib/auth';
import { WALLET_CHALLENGE_COOKIE, VERIFIED_WALLET_COOKIE, readWalletClaim, spendingWalletCookieOptions,
  verifiedWalletToken, walletChallenge, walletChallengeMessage } from '../../../../../lib/spending-wallet';

function needsEmailConfirmation(session: { wallet_address?: string | null; wallet_rebind_verified_at?: number | null }, owner: string) {
  if (!session.wallet_address || session.wallet_address.toLowerCase() === owner.toLowerCase()) return false;
  const age = Date.now() - (session.wallet_rebind_verified_at ?? 0) * 1000;
  return !session.wallet_rebind_verified_at || age < 0 || age > 600000;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: { message: 'Sign in first' } }, { status: 401 });
  if (!session.email_verified_at) return NextResponse.json({ error: { message: 'Verify your email before linking a wallet' } }, { status: 409 });
  const owner = req.nextUrl.searchParams.get('owner') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return NextResponse.json({ error: { message: 'Invalid wallet address' } }, { status: 400 });
  if (needsEmailConfirmation(session, owner)) return NextResponse.json({ error: { code: 'EMAIL_RECONFIRM_REQUIRED', message: 'This is a different wallet from the one linked to your account. Choose Replace linked wallet and confirm your account email before signing.' } }, { status: 409 });
  const challenge = walletChallenge(sessionHolder(session), req.nextUrl.origin, owner);
  await saveAuthChallenge(challenge.token, 300000);
  const response = NextResponse.json({ message: challenge.message }, { headers: { 'cache-control': 'no-store' } });
  response.cookies.set(WALLET_CHALLENGE_COOKIE, challenge.token, spendingWalletCookieOptions(300));
  return response;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: { message: 'Sign in first' } }, { status: 401 });
  if (!session.email_verified_at) return NextResponse.json({ error: { message: 'Verify your email before linking a wallet' } }, { status: 409 });
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: { message: 'Cross-origin request rejected' } }, { status: 403 });
  const challenge = readWalletClaim(req.cookies.get(WALLET_CHALLENGE_COOKIE)?.value, 'challenge', sessionHolder(session), req.nextUrl.origin);
  if (!challenge) return NextResponse.json({ error: { message: 'Wallet verification expired. Try again.' } }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { signature?: string };
  if (!body || typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) return NextResponse.json({ error: { message: 'A wallet signature is required' } }, { status: 400 });
  const signer = await recoverMessageAddress({ message: walletChallengeMessage(challenge), signature: body.signature as `0x${string}` }).catch(() => '');
  if (signer.toLowerCase() !== challenge.owner) return NextResponse.json({ error: { message: 'Signature does not match the connected wallet' } }, { status: 403 });
  const existingWallet = session.wallet_address?.toLowerCase();
  if (needsEmailConfirmation(session, challenge.owner)) {
    return NextResponse.json(
      { error: { code: 'EMAIL_RECONFIRM_REQUIRED', message: 'Confirm your account email with a new code before replacing the linked wallet.' } },
      { status: 409 },
    );
  }
  if (!await consumeAuthChallenge(req.cookies.get(WALLET_CHALLENGE_COOKIE)!.value)) return NextResponse.json({ error: { message: 'Wallet verification already used or expired' } }, { status: 403 });
  try { await accountProfiles().bind(session.email!, existingWallet ?? null, challenge.owner); }
  catch { return NextResponse.json({ error: { message: 'Account changed. Sign in and verify your wallet again.' } }, { status: 409 }); }
  const response = NextResponse.json({ owner_address: challenge.owner, wallet_address: challenge.owner });
  response.cookies.set(VERIFIED_WALLET_COOKIE, verifiedWalletToken(challenge), spendingWalletCookieOptions(8 * 3600));
  response.cookies.set(WALLET_CHALLENGE_COOKIE, '', spendingWalletCookieOptions(0));
  return attachSessionCookie(
    response,
    mergeSessionIdentity(session, {
      wallet_address: challenge.owner,
      wallet_rebind_verified_at: null,
    }),
  );
}
