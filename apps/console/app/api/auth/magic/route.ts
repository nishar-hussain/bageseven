import { NextRequest, NextResponse } from 'next/server';
import { sendNotify } from '@bagseven/notify';
import { isAllowedEmail, issueMagicToken } from '../../../../lib/auth';

const recent = new Map<string, number>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const prev = recent.get(key) ?? 0;
  if (now - prev < 15_000) return true;
  recent.set(key, now);
  if (recent.size > 5000) {
    for (const [k, t] of recent) {
      if (now - t > 60_000) recent.delete(k);
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; next?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: 'This email is not on the invite list' }, { status: 403 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`${ip}:${email}`)) {
    return NextResponse.json({ error: 'Please wait a few seconds before requesting another link' }, { status: 429 });
  }

  const token = issueMagicToken(email);
  const origin = req.nextUrl.origin;
  const next = body.next && body.next.startsWith('/') ? body.next : '/app';
  const url = `${origin}/api/auth/callback?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;

  const sent = await sendNotify({
    to: email,
    event: 'magic_link',
    subject: 'Sign in to Bagseven',
    title: 'Your sign-in link',
    body: 'Use this link within 15 minutes. Your session lasts 8 hours.',
    href: url,
    meta: { next },
  });

  if (process.env.NODE_ENV === 'production' && (!sent.ok || sent.skipped)) {
    return NextResponse.json({ error: 'Email delivery is unavailable. Please try again later.' }, { status: 503 });
  }

  const payload: Record<string, unknown> = { ok: true };
  if (sent.id) payload.email_id = sent.id;
  if (sent.error) payload.email_error = sent.error;
  // Never leak magic URLs in production — Resend must work.
  if ((process.env.NODE_ENV ?? 'development') !== 'production' && (sent.skipped || !sent.ok)) {
    payload.dev_hint = url;
  }
  return NextResponse.json(payload);
}
