import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

export const SESSION_COOKIE = 'bagseven_session';
export const SESSION_MAX_AGE = 60 * 60 * 8;
const MAGIC_MAX_AGE = 15 * 60;

export type Session = { email: string; exp: number; k?: 'session' | 'magic' };

function secret(): string {
  return process.env.AUTH_SECRET?.trim() || process.env.DAEMON_AUTH_TOKEN?.trim() || 'dev-only-change-me';
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

/** Optional invite list. Empty = any email (product default). */
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

function encode(email: string, kind: 'session' | 'magic', ttlSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), exp, k: kind } satisfies Session)).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

export function encodeSession(email: string): string {
  return encode(email, 'session', SESSION_MAX_AGE);
}

export function decodeToken(token: string | undefined | null, kind?: 'session' | 'magic'): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (!session.email || session.exp * 1000 < Date.now()) return null;
    if (kind && session.k && session.k !== kind) return null;
    return session;
  } catch {
    return null;
  }
}

export function decodeSession(token: string | undefined | null): Session | null {
  return decodeToken(token, 'session') ?? decodeToken(token);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export function attachSessionCookie(res: NextResponse, email: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, encodeSession(email), sessionCookieOptions());
  return res;
}

export function clearSessionOn(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

export async function setSessionCookie(email: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(email), sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export function issueMagicToken(email: string): string {
  return encode(email, 'magic', MAGIC_MAX_AGE);
}

export function consumeMagicToken(token: string): string | null {
  return decodeToken(token, 'magic')?.email ?? null;
}
