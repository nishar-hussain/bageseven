import { NextRequest, NextResponse } from 'next/server';
import { sendNotify } from '@bagseven/notify';
import { isAllowedEmail, issueMagicToken } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; next?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: 'This email is not on the operator allowlist' }, { status: 403 });
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

  const payload: Record<string, unknown> = { ok: true };
  if (sent.id) payload.email_id = sent.id;
  if (sent.error) payload.email_error = sent.error;
  if (sent.skipped || !sent.ok) payload.dev_hint = url;
  return NextResponse.json(payload);
}
