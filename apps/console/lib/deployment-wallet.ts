import type { NextRequest } from 'next/server';
import { sessionHolder, type Session } from './auth';
import { readWalletClaim, type WalletClaim } from './spending-wallet';

export const DEPLOYMENT_CHALLENGE_COOKIE = 'bagseven_registry_wallet_challenge';
export const DEPLOYMENT_WALLET_COOKIE = 'bagseven_registry_wallet';
export const deploymentActor = (session: Session) => `registry-deployment:${sessionHolder(session)}`;
export function deploymentWalletMessage(claim: WalletClaim) {
  return ['Bagseven: verify wallet for a new Fuji registry deployment', `Website: ${claim.origin}`,
    `Signed-in account: ${claim.actor.slice('registry-deployment:'.length)}`, `Wallet: ${claim.owner}`,
    `Nonce: ${claim.nonce}`, `Expires: ${new Date(claim.exp).toISOString()}`,
    'This signature verifies this wallet for preparing and confirming a new registry deployment only.',
    'It does not replace your linked account wallet, transfer funds, or authorize agent spending.',
    'The deployment transaction requires a separate wallet approval.'].join('\n');
}
export function verifiedDeploymentOwner(req: NextRequest, session: Session) {
  return readWalletClaim(req.cookies.get(DEPLOYMENT_WALLET_COOKIE)?.value, 'ownership', deploymentActor(session), req.nextUrl.origin)?.owner ?? null;
}
