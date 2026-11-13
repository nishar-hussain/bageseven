import { NextRequest, NextResponse } from 'next/server';
import { claimAuthRate, saveAuthChallenge } from '../../../../../lib/auth-challenges';
import { sendNotify } from '@bagseven/notify';
import {
  generateOtpCode,
  isAllowedEmail,
  issueOtpChallenge,
} from '../../../../../lib/auth';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: 'This email is not on the invite list' }, { status: 403 });
  }

  if (!await claimAuthRate(email)) {
    return NextResponse.json({ error: 'Please wait a few seconds before requesting another code' }, { status: 429 });
  }

  const code = generateOtpCode();
  const challenge = issueOtpChallenge(email, code);
  await saveAuthChallenge(challenge, 600000);

  const sent = await sendNotify({
    to: email,
    event: 'magic_link',
    subject: 'Your Bagseven verification code',
    title: 'Verify your email',
    body: 'Use the code below to verify your email for Bagseven. Return to the window where you started to finish verification.',
    code,
  });

  const allowDevelopmentHint = process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
  if (!allowDevelopmentHint && (!sent.ok || sent.skipped)) {
    return NextResponse.json({ error: 'Email delivery is unavailable. Please try again later.' }, { status: 503 });
  }

  const payload: Record<string, unknown> = {
    ok: true,
    challenge,
    email,
  };
  if (sent.id) payload.email_id = sent.id;
  if (allowDevelopmentHint && (sent.skipped || !sent.ok)) {
    payload.dev_hint = code;
  }
  return NextResponse.json(payload);
}
