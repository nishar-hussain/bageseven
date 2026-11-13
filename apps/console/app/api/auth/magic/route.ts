import { appDestination } from '../../../../lib/auth-destination';
import { NextRequest, NextResponse } from 'next/server';
import { claimAuthRate, saveAuthChallenge } from '../../../../lib/auth-challenges';
import { sendNotify } from '@bagseven/notify';
import { isAllowedEmail, issueMagicToken } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; next?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: 'This email is not on the invite list' }, { status: 403 });
  }

  if (!await claimAuthRate(email)) {
    return NextResponse.json({ error: 'Please wait a few seconds before requesting another link' }, { status: 429 });
  }

  const token = issueMagicToken(email);
  await saveAuthChallenge(token, 15 * 60000);
  const origin = req.nextUrl.origin;
  const next = appDestination(body.next);
  const url = `${origin}/api/auth/callback?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;

  const sent = await sendNotify({
    to: email,
    event: 'magic_link',
    subject: 'Sign in to Bagseven',
    title: 'Your workspace awaits.',
    body: 'Sign in to your Bagseven workspace with the button below. This link expires in 15 minutes and can be used once.',
    actionLabel: 'Sign in to your workspace',
    href: url,
    meta: { next },
  });

  const allowDevelopmentHint = process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
  if (!allowDevelopmentHint && (!sent.ok || sent.skipped)) {
    return NextResponse.json({ error: 'Email delivery is unavailable. Please try again later.' }, { status: 503 });
  }

  const payload: Record<string, unknown> = { ok: true };
  if (sent.id) payload.email_id = sent.id;
  if (sent.error) payload.email_error = sent.error;
  // Never leak magic URLs in production — Resend must work.
  if (allowDevelopmentHint && (sent.skipped || !sent.ok)) {
    payload.dev_hint = url;
  }
  return NextResponse.json(payload);
}
