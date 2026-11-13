import { renderNotificationEmail } from './email.js';
export { renderNotificationEmail } from './email.js';
import { Resend } from 'resend';

export type NotifyEvent =
  | 'magic_link'
  | 'grant_minted'
  | 'credits_bought'
  | 'paid_run'
  | 'renewal_cancelled';

export interface NotifyPayload {
  to: string;
  event: NotifyEvent;
  subject?: string;
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
  code?: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

function fromAddress(): string {
  const raw = process.env.RESEND_FROM ?? 'Bagseven <bags@cesthq.com>';
  return raw.replace(/^["']|["']$/g, '');
}

function dashboardUrl(): string {
  return (process.env.CONSOLE_URL?.trim() || process.env.NEXT_PUBLIC_CONSOLE_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
}

export function notifyConfigured(): boolean {
  return process.env.NOTIFY_MODE !== 'log' && Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendNotify(payload: NotifyPayload): Promise<{ ok: boolean; id?: string; skipped?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key || process.env.NOTIFY_MODE === 'log') {
    const reason = process.env.NOTIFY_MODE === 'log' ? 'NOTIFY_MODE=log' : 'RESEND_API_KEY unset';
    console.log(`[notify] skip ${payload.event} → ${payload.to} (${reason})`);
    return { ok: true, skipped: reason };
  }
  const resend = new Resend(key);
  const subject = payload.subject ?? `[Bagseven] ${payload.title}`;
  const href = payload.href ?? `${dashboardUrl()}/app`;
  const rendered = renderNotificationEmail(payload, href);
  const { data, error } = await resend.emails.send({
    from: fromAddress(),
    to: payload.to,
    replyTo: operatorNotifyEmail() ?? undefined,
    subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (error) {
    const msg = error.message ?? String(error);
    console.error(`[notify] ${payload.event} failed`, error);
    return { ok: false, error: msg };
  }
  console.log(`[notify] ${payload.event} → ${payload.to} id=${data?.id ?? '?'}`);
  return { ok: true, id: data?.id };
}

export function operatorNotifyEmail(): string | null {
  const email = process.env.OPERATOR_NOTIFY_EMAIL?.trim();
  return email || null;
}

export function notifyDestinations(actor?: string | null): string[] {
  const set = new Set<string>();
  if (actor?.includes('@')) set.add(actor.trim().toLowerCase());
  const ops = operatorNotifyEmail();
  if (ops?.includes('@')) set.add(ops.toLowerCase());
  return [...set];
}

export async function notifyOperator(
  event: NotifyEvent,
  title: string,
  body: string,
  meta?: NotifyPayload['meta'],
  actor?: string | null,
): Promise<void> {
  const dests = notifyDestinations(actor);
  if (dests.length === 0) {
    console.log(`[notify] no recipients for ${event}`);
    return;
  }
  await Promise.all(dests.map((to) => sendNotify({ to, event, title, body, meta })));
}
