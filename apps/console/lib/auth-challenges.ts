import { CredentialStore } from '@bagseven/db';
import { consoleDatabase } from './account-profiles';
const store = () => new CredentialStore<{ exp: number; attempts: number }>(consoleDatabase(), 'console-auth');
export async function saveAuthChallenge(token: string, ttlMs: number) {
  await store().prune();
  await store().set(token, { exp: Date.now() + ttlMs, attempts: 0 });
}
export const attemptAuthChallenge = (token: string) => store().attempt(token, 5);
export async function consumeAuthChallenge(token: string) { return Boolean(await store().take(token)); }
export const claimAuthRate = (email: string) => store().claim(`rate:${email}`, { exp: Date.now() + 15000, attempts: 0 });
