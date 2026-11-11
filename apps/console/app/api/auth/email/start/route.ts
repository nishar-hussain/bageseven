import { NextRequest, NextResponse } from 'next/server';
import { sendNotify } from '@bagseven/notify';
import {
  generateOtpCode,
  isAllowedEmail,
  issueOtpChallenge,
} from '../../../../../lib/auth';

const recent = new Map<string, number>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const prev = recent.get(key) ?? 0;
  if (now - prev < 15_000) return true;
  recent.set(key, now);
  return false;
}

/** Start an email-first Bagseven sign-in or verified-email re-confirmation. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: 'This email is not on the invite list' }, { status: 403 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`${ip}:${email}`)) {
    return NextResponse.json({ error: 'Please wait a few seconds before requesting another code' }, { status: 429 });
  }

  const code = generateOtpCode();
  const challenge = issueOtpChallenge(email, code);

  const sent = await sendNotify({
    to: email,
    event: 'magic_link',
    subject: 'Your Bagseven verification code',
    title: 'Verify your email',
    body: `Your code is ${code}. It expires in 10 minutes. It confirms this address for your Bagseven account, invoices, and receipts.`,
    meta: { code, purpose: 'email_otp' },
  });

  if (process.env.NODE_ENV === 'production' && (!sent.ok || sent.skipped)) {
    return NextResponse.json({ error: 'Email delivery is unavailable. Please try again later.' }, { status: 503 });
  }

  const payload: Record<string, unknown> = {
    ok: true,
    challenge,
    email,
  };
  if (sent.id) payload.email_id = sent.id;
  if ((process.env.NODE_ENV ?? 'development') !== 'production' && (sent.skipped || !sent.ok)) {
    payload.dev_hint = code;
  }
  return NextResponse.json(payload);
}
