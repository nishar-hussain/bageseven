import { NextRequest, NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { getSession, sessionIsValid } from '../../../../lib/auth';
import { attemptAuthChallenge, consumeAuthChallenge, saveAuthChallenge } from '../../../../lib/auth-challenges';
import { deploymentActor, deploymentWalletMessage, DEPLOYMENT_CHALLENGE_COOKIE, DEPLOYMENT_WALLET_COOKIE } from '../../../../lib/deployment-wallet';
import { readWalletClaim, spendingWalletCookieOptions, verifiedWalletToken, walletChallenge } from '../../../../lib/spending-wallet';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !sessionIsValid(session) || !session.email_verified_at) return NextResponse.json({ error: { message: 'Sign in with your verified email first' } }, { status: 401 });
  const owner = req.nextUrl.searchParams.get('owner') ?? '';
  if (!/^0x[\da-f]{40}$/i.test(owner)) return NextResponse.json({ error: { message: 'Invalid wallet address' } }, { status: 400 });
  const challenge = walletChallenge(deploymentActor(session), req.nextUrl.origin, owner);
  await saveAuthChallenge(challenge.token, 300000);
  const response = NextResponse.json({ message: deploymentWalletMessage(challenge.claim) }, { headers: { 'cache-control': 'no-store' } });
  response.cookies.set(DEPLOYMENT_CHALLENGE_COOKIE, challenge.token, spendingWalletCookieOptions(300));
  return response;
}
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !sessionIsValid(session) || !session.email_verified_at) return NextResponse.json({ error: { message: 'Sign in with your verified email first' } }, { status: 401 });
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: { message: 'Cross-origin request rejected' } }, { status: 403 });
  const token = req.cookies.get(DEPLOYMENT_CHALLENGE_COOKIE)?.value;
  const challenge = readWalletClaim(token, 'challenge', deploymentActor(session), req.nextUrl.origin);
  if (!token || !challenge || !await attemptAuthChallenge(token)) return NextResponse.json({ error: { message: 'Deployment wallet verification expired. Prepare again.' } }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { signature?: string };
  const signer = typeof body.signature === 'string' && /^0x[\da-f]{130}$/i.test(body.signature)
    ? await recoverMessageAddress({ message: deploymentWalletMessage(challenge), signature: body.signature as `0x${string}` }).catch(() => '') : '';
  if (signer.toLowerCase() !== challenge.owner) return NextResponse.json({ error: { message: 'Signature does not match the deployment wallet' } }, { status: 403 });
  if (!await consumeAuthChallenge(token)) return NextResponse.json({ error: { message: 'Verification already used. Prepare again.' } }, { status: 403 });
  const response = NextResponse.json({ owner_address: challenge.owner });
  response.cookies.set(DEPLOYMENT_WALLET_COOKIE, verifiedWalletToken(challenge, 10 * 60000), spendingWalletCookieOptions(600));
  response.cookies.set(DEPLOYMENT_CHALLENGE_COOKIE, '', spendingWalletCookieOptions(0));
  return response;
}
