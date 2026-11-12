import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { GET, POST } from '../app/api/deployment-wallet/verify/route';
import { POST as proxy } from '../app/api/daemon/[...path]/route';
import { DEPLOYMENT_CHALLENGE_COOKIE, DEPLOYMENT_WALLET_COOKIE, deploymentActor } from '../lib/deployment-wallet';
import { readWalletClaim, verifiedWalletToken, walletChallenge } from '../lib/spending-wallet';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), daemonFetch: vi.fn(), challenges: new Set<string>() }));
vi.mock('../lib/auth', () => ({ getSession: mocks.getSession, sessionIsValid: (s: unknown) => Boolean(s), sessionHolder: (s: { email: string }) => s.email }));
vi.mock('../lib/auth-challenges', () => ({
  saveAuthChallenge: async (token: string) => { mocks.challenges.add(token); },
  attemptAuthChallenge: async (token: string) => mocks.challenges.has(token),
  consumeAuthChallenge: async (token: string) => mocks.challenges.delete(token),
}));
vi.mock('../lib/daemon-bff', () => ({ daemonFetch: mocks.daemonFetch }));
vi.mock('../lib/provider-gas-scope', () => ({ providerScopeHeaders: () => ({}) }));
const origin = 'http://localhost:3000';
const oldWallet = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const deploymentWallet = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const session = { email: 'human@example.com', email_verified_at: 1, wallet_address: oldWallet.address, exp: 2000000000 };
beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'deployment-wallet-test-secret');
  mocks.challenges.clear(); mocks.getSession.mockResolvedValue(session);
  mocks.daemonFetch.mockReset(); mocks.daemonFetch.mockResolvedValue(Response.json({ prepared: true }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function submit(signature: string, token: string, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/deployment-wallet/verify`, { method: 'POST',
    headers: { origin: requestOrigin, cookie: `${DEPLOYMENT_CHALLENGE_COOKIE}=${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ signature }) }));
}
describe('registry deployment wallet authorization', () => {
  it('verifies a different connected wallet without replacing the account wallet, and binds the BFF draft to its proof', async () => {
    const challenge = await GET(new NextRequest(`${origin}/api/deployment-wallet/verify?owner=${deploymentWallet.address}`));
    const { message } = await challenge.json();
    expect(message).toContain('does not replace your linked account wallet');
    const token = challenge.cookies.get(DEPLOYMENT_CHALLENGE_COOKIE)!.value;
    const signature = await deploymentWallet.signMessage({ message });
    const verified = await submit(signature, token);
    expect(verified.status).toBe(200);
    expect(session.wallet_address).toBe(oldWallet.address);
    const proof = verified.cookies.get(DEPLOYMENT_WALLET_COOKIE)!;
    expect(proof.httpOnly).toBe(true);
    expect(proof.maxAge).toBe(600);
    expect(readWalletClaim(proof.value, 'ownership', deploymentActor(session), origin)?.owner).toBe(deploymentWallet.address.toLowerCase());
    expect(readWalletClaim(proof.value, 'ownership', session.email, origin)).toBeNull();
    const response = await proxy(new NextRequest(`${origin}/api/daemon/deployments/registry/prepare`, { method: 'POST',
      headers: { cookie: `${DEPLOYMENT_WALLET_COOKIE}=${proof.value}` }, body: JSON.stringify({ owner: oldWallet.address }) }),
      { params: Promise.resolve({ path: ['deployments', 'registry', 'prepare'] }) });
    expect(response.status).toBe(200);
    expect(JSON.parse(mocks.daemonFetch.mock.calls[0]![1].body).owner).toBe(deploymentWallet.address.toLowerCase());
    expect((await submit(signature, token)).status).toBe(403);
  });
  it('rejects another signer, cross-origin proofs, account changes and ordinary wallet-link challenges', async () => {
    const challenge = await GET(new NextRequest(`${origin}/api/deployment-wallet/verify?owner=${deploymentWallet.address}`));
    const { message } = await challenge.json();
    const token = challenge.cookies.get(DEPLOYMENT_CHALLENGE_COOKIE)!.value;
    expect((await submit(await oldWallet.signMessage({ message }), token)).status).toBe(403);
    const signature = await deploymentWallet.signMessage({ message });
    expect((await submit(signature, token, 'https://attacker.example')).status).toBe(403);
    mocks.getSession.mockResolvedValue({ ...session, email: 'other@example.com' });
    expect((await submit(signature, token)).status).toBe(403);
    mocks.getSession.mockResolvedValue(session);
    const ordinary = walletChallenge(session.email, origin, deploymentWallet.address);
    expect((await submit(await deploymentWallet.signMessage({ message: ordinary.message }), ordinary.token)).status).toBe(403);
  });
  it('requires a current deployment-specific proof even when an account already has a linked wallet', async () => {
    const call = (proof?: string) => proxy(new NextRequest(`${origin}/api/daemon/deployments/registry/prepare`, { method: 'POST',
      headers: proof ? { cookie: `${DEPLOYMENT_WALLET_COOKIE}=${proof}` } : {}, body: '{}' }),
      { params: Promise.resolve({ path: ['deployments', 'registry', 'prepare'] }) });
    expect((await call()).status).toBe(403);
    const claim = walletChallenge(deploymentActor(session), origin, deploymentWallet.address).claim;
    const proof = verifiedWalletToken(claim, 600000);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 600001);
    expect((await call(proof)).status).toBe(403);
    expect(mocks.daemonFetch).not.toHaveBeenCalled();
  });
});
