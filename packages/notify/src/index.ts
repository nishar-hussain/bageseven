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
  meta?: Record<string, string | number | boolean | null | undefined>;
}

function fromAddress(): string {
  const raw = process.env.RESEND_FROM ?? 'Bagseven <bags@cesthq.com>';
  return raw.replace(/^["']|["']$/g, '');
}

function dashboardUrl(): string {
  return (process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function notifyConfigured(): boolean {
  return process.env.NOTIFY_MODE !== 'log' && Boolean(process.env.RESEND_API_KEY?.trim());
}

function htmlEmail(title: string, body: string, href: string, meta?: NotifyPayload['meta']): string {
  const rows = Object.entries(meta ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 8px;color:#63636d;font-size:13px">${k}</td><td style="padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:13px">${String(v)}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html><body style="margin:0;background:#f2f2f2;font-family:Switzer,system-ui,sans-serif;color:#0e0e10">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ececf0">
    <div style="background:#0c0a0b;color:#fff;padding:20px 24px;font-weight:600">Bagseven</div>
    <div style="padding:24px">
      <div style="height:3px;width:40px;background:#0002f8;margin-bottom:16px"></div>
      <h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
      <p style="line-height:1.5;color:#3a3a40">${body}</p>
      ${rows ? `<table style="margin-top:16px;width:100%;border-collapse:collapse">${rows}</table>` : ''}
      <p style="margin-top:24px"><a href="${href}" style="display:inline-block;background:#0e0e10;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-size:14px;font-weight:600">Open Bagseven</a></p>
    </div>
  </div>
</body></html>`;
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
  const { data, error } = await resend.emails.send({
    from: fromAddress(),
    to: payload.to,
    replyTo: operatorNotifyEmail() ?? undefined,
    subject,
    html: htmlEmail(payload.title, payload.body, href, payload.meta),
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
