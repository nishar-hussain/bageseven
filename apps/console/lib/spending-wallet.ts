import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { sessionHolder, type Session } from './auth';
import { authSecretFromEnv } from './session-crypto';

export const WALLET_CHALLENGE_COOKIE = 'bagseven_spending_challenge';
export const VERIFIED_WALLET_COOKIE = 'bagseven_spending_wallet';
export type WalletClaim = { kind: 'challenge' | 'ownership'; actor: string; origin: string; owner: string; nonce: string; exp: number };
function mac(payload: string) {
  return createHmac('sha256', authSecretFromEnv(process.env)).update(`spending-wallet:${payload}`).digest('base64url');
}
function encode(claim: WalletClaim) {
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${payload}.${mac(payload)}`;
}
export function readWalletClaim(token: string | undefined, kind: WalletClaim['kind'], actor: string, origin: string): WalletClaim | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(mac(payload)); const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString()) as WalletClaim;
    if (claim.kind !== kind || claim.actor !== actor || claim.origin !== origin || !Number.isFinite(claim.exp) || claim.exp <= Date.now() || !/^0x[0-9a-fA-F]{40}$/.test(claim.owner)) return null;
    return claim;
  } catch { return null; }
}
export function walletChallenge(actor: string, origin: string, owner: string) {
  const claim: WalletClaim = { kind: 'challenge', actor, origin, owner: owner.toLowerCase(), nonce: randomUUID(), exp: Date.now() + 5 * 60_000 };
  return { claim, token: encode(claim), message: walletChallengeMessage(claim) };
}
export function walletChallengeMessage(claim: WalletClaim) {
  return ['Bagseven: verify Avalanche wallet ownership', `Website: ${claim.origin}`, `Account: ${claim.actor}`,
    `Wallet: ${claim.owner}`, `Nonce: ${claim.nonce}`, `Expires: ${new Date(claim.exp).toISOString()}`,
    'This signature links your wallet to this signed-in account. It does not transfer funds or authorize agent spending.'].join('\n');
}
export function verifiedWalletToken(claim: WalletClaim, ttlMs = 8 * 60 * 60_000) {
  return encode({ ...claim, kind: 'ownership', exp: Date.now() + ttlMs });
}
export function verifiedSpendingOwner(req: NextRequest, session: Session): string | null {
  return readWalletClaim(req.cookies.get(VERIFIED_WALLET_COOKIE)?.value, 'ownership', sessionHolder(session), req.nextUrl.origin)?.owner ?? null;
}
export function spendingWalletCookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge };
}
