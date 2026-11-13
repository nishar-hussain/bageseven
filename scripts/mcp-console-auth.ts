import { AccountProfiles, McpConsoleConsent, createDb } from '@bagseven/db';
import type { Request, Response } from 'express';
let database: ReturnType<typeof createDb> | undefined;
const db = () => database ??= createDb({ connectionString: process.env.DATABASE_URL || '', max: 5 });
const cookieName = 'bagseven_mcp_console_consent';
export function consoleConsentOrigin() {
  const raw = process.env.CONSOLE_URL || process.env.NEXT_PUBLIC_CONSOLE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw Error('Invalid console origin');
  return url.origin;
}
export async function beginConsoleConsent(req: Request, res: Response, issuer: string, query: string) {
  const origin = consoleConsentOrigin();
  if (!origin) return false;
  const store = new McpConsoleConsent(db());
  await store.requests.prune();
  await store.proofs.prune();
  const request = await store.begin(issuer, query);
  res.cookie(cookieName, request.nonce, { httpOnly: true, secure: issuer.startsWith('https:'), sameSite: 'lax', path: '/oauth', maxAge: 600000 });
  const target = new URL('/app/mcp/authorize', origin); target.searchParams.set('request', request.id);
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, target.href);
  return true;
}
export async function finishConsoleConsent(req: Request, res: Response, issuer: string) {
  const nonce = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw Error('Connection request expired. Start again from ChatGPT.');
  const proof = await new McpConsoleConsent(db()).finish(code, nonce, issuer);
  if (!proof) throw Error('Connection request expired or belongs to another browser. Start again from ChatGPT.');
  const profile = await new AccountProfiles(db()).get(proof.email);
  if (!profile?.walletAddress || profile.walletAddress.toLowerCase() !== proof.wallet.toLowerCase()) throw Error('Your linked wallet changed. Verify your account again.');
  res.clearCookie(cookieName, { path: '/oauth' });
  return proof;
}
