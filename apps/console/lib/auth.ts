import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { authSecretFromEnv } from './session-crypto';

export const SESSION_COOKIE = 'bagseven_session';
export const SESSION_MAX_AGE = 60 * 60 * 8;
const MAGIC_MAX_AGE = 15 * 60;
const OTP_MAX_AGE = 10 * 60;

export type Session = {
  exp: number;
  k?: 'session' | 'magic' | 'otp';
  /** World nullifier / human continuity id — primary identity. */
  world_human_id?: string;
  email?: string;
  email_verified_at?: number | null;
  mock?: boolean;
};

function secret(): string {
  return authSecretFromEnv(process.env);
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

/** Optional invite list. Empty = any email (product default). Applies only when email is used. */
export function allowedEmails(): string[] {
  const raw = process.env.AUTH_ALLOWLIST ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string): boolean {
  const allow = allowedEmails();
  if (allow.length === 0) return true;
  return allow.includes(email.trim().toLowerCase());
}

export function sessionIsValid(session: Session | null | undefined): boolean {
  if (!session) return false;
  if (session.exp * 1000 < Date.now()) return false;
  return Boolean(session.world_human_id?.trim() || session.email?.trim());
}

/** Prefer verified/claimed email; else world holder. */
export function sessionHolder(session: Session): string {
  if (session.email?.trim()) return session.email.trim().toLowerCase();
  if (session.world_human_id?.trim()) return `world:${session.world_human_id.trim()}`;
  return 'anonymous';
}

function encodePayload(session: Omit<Session, 'exp' | 'k'> & { k: Session['k']; ttlSec: number }): string {
  const exp = Math.floor(Date.now() / 1000) + session.ttlSec;
  const body: Session = {
    exp,
    k: session.k,
    world_human_id: session.world_human_id,
    email: session.email?.toLowerCase(),
    email_verified_at: session.email_verified_at ?? null,
    mock: session.mock,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function encodeSession(input: {
  world_human_id?: string;
  email?: string;
  email_verified_at?: number | null;
  mock?: boolean;
}): string {
  if (!input.world_human_id?.trim() && !input.email?.trim()) {
    throw new Error('SESSION_REQUIRES_IDENTITY');
  }
  return encodePayload({
    k: 'session',
    ttlSec: SESSION_MAX_AGE,
    world_human_id: input.world_human_id,
    email: input.email,
    email_verified_at: input.email_verified_at ?? null,
    mock: input.mock,
  });
}

export function decodeToken(token: string | undefined | null, kind?: 'session' | 'magic' | 'otp'): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (!sessionIsValid(session)) return null;
    if (kind === 'session' && session.k === 'magic') return null;
    if (kind === 'session' && session.k === 'otp') return null;
    if (kind === 'magic' && session.k && session.k !== 'magic') return null;
    if (kind === 'otp' && session.k && session.k !== 'otp') return null;
    return session;
  } catch {
    return null;
  }
}

export function decodeSession(token: string | undefined | null): Session | null {
  return decodeToken(token, 'session');
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export function attachSessionCookie(
  res: NextResponse,
  input: { world_human_id?: string; email?: string; email_verified_at?: number | null; mock?: boolean },
): NextResponse {
  res.cookies.set(SESSION_COOKIE, encodeSession(input), sessionCookieOptions());
  return res;
}

export function clearSessionOn(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

export async function setSessionCookie(input: {
  world_human_id?: string;
  email?: string;
  email_verified_at?: number | null;
  mock?: boolean;
}): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(input), sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Recovery / invite only — not the primary login CTA. */
export function issueMagicToken(email: string): string {
  return encodePayload({ k: 'magic', ttlSec: MAGIC_MAX_AGE, email: email.toLowerCase() });
}

export function consumeMagicToken(token: string): string | null {
  return decodeToken(token, 'magic')?.email ?? null;
}

/** Short-lived OTP challenge bound to email (not a session). */
export function issueOtpChallenge(email: string, code: string): string {
  const exp = Math.floor(Date.now() / 1000) + OTP_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), code, exp, k: 'otp' })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function consumeOtpChallenge(token: string, code: string): string | null {
  if (!token || !code) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string;
      code?: string;
      exp?: number;
      k?: string;
    };
    if (parsed.k !== 'otp' || !parsed.email || !parsed.code || !parsed.exp) return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    if (parsed.code !== code.trim()) return null;
    return parsed.email.toLowerCase();
  } catch {
    return null;
  }
}

export function generateOtpCode(): string {
  return String(randomInt(100000, 999999));
}
