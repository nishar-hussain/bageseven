import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { GET, POST } from '../app/api/auth/wallet/verify/route';
import { readWalletClaim, verifiedWalletToken, walletChallenge, VERIFIED_WALLET_COOKIE, WALLET_CHALLENGE_COOKIE } from '../lib/spending-wallet';
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  sessionIsValid: vi.fn(),
  sessionHolder: (s: { email: string }) => s.email,
  mergeSessionIdentity: (session: object, patch: object) => ({ ...session, ...patch }),
  attachSessionCookie: (response: Response) => response,
}));
vi.mock('../lib/auth', () => auth);
vi.mock('../lib/account-profiles', () => ({ accountProfiles: () => ({ bind: async () => ({}) }) }));
vi.mock('../lib/auth-challenges', () => ({ saveAuthChallenge: async () => {}, consumeAuthChallenge: async () => true }));
const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const origin = 'http://localhost:3000';
beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'test-wallet-proof-secret');
  auth.getSession.mockResolvedValue({ email: 'human@example.com', email_verified_at: 1 }); auth.sessionIsValid.mockReturnValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function submit(signature: string, cookie?: string, website = origin) {
  return POST(new NextRequest(`${origin}/api/auth/wallet/verify`, { method: 'POST',
    headers: { origin: website, 'content-type': 'application/json', ...(cookie ? { cookie: `${WALLET_CHALLENGE_COOKIE}=${cookie}` } : {}) }, body: JSON.stringify({ signature }) }));
}
describe('verified ownership for connected spending wallets', () => {
  it('allows a real signature from a wallet absent from server configuration', async () => {
    const response = await GET(new NextRequest(`${origin}/api/auth/wallet/verify?owner=${account.address}`));
    expect(response.status).toBe(200);
    const { message } = await response.json();
    const challenge = response.cookies.get(WALLET_CHALLENGE_COOKIE)!.value;
    const signature = await account.signMessage({ message });
    const verified = await submit(signature, challenge);
    expect(verified.status).toBe(200);
    const proof = verified.cookies.get(VERIFIED_WALLET_COOKIE)!;
    expect(proof.httpOnly).toBe(true);
    expect(readWalletClaim(proof.value, 'ownership', 'human@example.com', origin)?.owner).toBe(account.address.toLowerCase());
    expect(verified.cookies.get(WALLET_CHALLENGE_COOKIE)?.maxAge).toBe(0);
  });
  it('rejects another signer, missing challenge and another signed-in human', async () => {
    const challenge = walletChallenge('human@example.com', origin, account.address);
    expect((await submit(await other.signMessage({ message: challenge.message }), challenge.token)).status).toBe(403);
    const signature = await account.signMessage({ message: challenge.message });
    expect((await submit(signature)).status).toBe(403);
    auth.getSession.mockResolvedValue({ email: 'another-human@example.com', email_verified_at: 1 });
    expect((await submit(signature, challenge.token)).status).toBe(403);
  });
  it('rejects expired, tampered, cross-origin and unauthenticated proofs', async () => {
    const challenge = walletChallenge('human@example.com', origin, account.address);
    const signature = await account.signMessage({ message: challenge.message });
    expect((await submit(signature, challenge.token, 'https://another.example')).status).toBe(403);
    expect((await submit(signature, `${challenge.token}changed`)).status).toBe(403);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 301_000);
    expect((await submit(signature, challenge.token)).status).toBe(403);
    auth.sessionIsValid.mockReturnValue(false);
    expect((await submit(signature, challenge.token)).status).toBe(401);
  });
  it('requires a fresh inbox confirmation before a linked wallet can be replaced', async () => {
    auth.getSession.mockResolvedValue({
      email: 'human@example.com', email_verified_at: 1, wallet_address: other.address,
    });
    const response = await GET(new NextRequest(`${origin}/api/auth/wallet/verify?owner=${account.address}`));
    const { message } = await response.json();
    const challenge = response.cookies.get(WALLET_CHALLENGE_COOKIE)!.value;
    const signature = await account.signMessage({ message });
    expect((await submit(signature, challenge)).status).toBe(409);
  });
  it('does not accept a challenge token as wallet ownership or reuse ownership on another site', () => {
    const challenge = walletChallenge('human@example.com', origin, account.address);
    expect(readWalletClaim(challenge.token, 'ownership', 'human@example.com', origin)).toBeNull();
    const proof = verifiedWalletToken(challenge.claim);
    expect(readWalletClaim(proof, 'ownership', 'human@example.com', 'https://another.example')).toBeNull();
  });
});
