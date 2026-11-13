import type { NotifyPayload } from './index.js';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const labels: Record<string, string> = { feature: 'Feature', holder: 'Customer account', remaining: 'Credits remaining', credits: 'Credits', payment_tx: 'Payment transaction', grant_id: 'Entitlement', worker_id: 'Agent', amount: 'Amount', paid_through: 'Paid through', renewal_enabled: 'Renewal enabled' };
function safeLink(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid email action URL');
  return url.toString();
}

/** Shared email-safe markup: inline styles, table layout, escaped dynamic text. */
export function renderNotificationEmail(payload: NotifyPayload, destination: string) {
  const href = safeLink(destination);
  const code = payload.code ?? (payload.meta?.purpose === 'email_otp' ? String(payload.meta.code ?? '') : '');
  if (code && !/^\d{6}$/.test(code)) throw Error('Invalid email verification code');
  const isAuth = payload.event === 'magic_link';
  const action = payload.actionLabel ?? (isAuth ? 'Sign in to Bagseven' : 'Open your workspace');
  const preheader = code ? 'Your Bagseven verification code. Expires in 10 minutes.' : payload.body;
  const rows = Object.entries(payload.meta ?? {})
    .filter(([key, value]) => !['code', 'purpose', 'next'].includes(key) && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => '<tr><td style="padding:12px 0;border-bottom:1px solid #e1e3e9;color:#667086;font-size:12px;vertical-align:top;width:36%">' + escape(labels[key] ?? key.replaceAll('_', ' ')) + '</td><td style="padding:12px 0 12px 16px;border-bottom:1px solid #e1e3e9;color:#1d2433;font-size:12px;line-height:1.6;word-break:break-word">' + escape(value) + '</td></tr>').join('');
  const cta = code ? '' : '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#112d94" style="border-radius:8px"><a href="' + escape(href) + '" style="display:inline-block;padding:16px 24px;font:600 14px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px">' + escape(action) + ' &rarr;</a></td></tr></table>';
  const footer = isAuth ? 'Only continue if you requested this email. Bagseven will never ask you to send a private key, recovery phrase or wallet password.' : 'Your billing identity stays private. Wallet payments and spending permissions require your explicit approval.';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>' + escape(payload.title) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f4f0;color:#1d2433;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">' +
    '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' + escape(preheader.slice(0, 150)) + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f4f0"><tr><td align="center" style="padding:36px 16px">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px"><tr><td style="padding:0 8px 24px;color:#112d94;font:30px Georgia,serif">Bagseven<span style="font:10px Arial,Helvetica,sans-serif;color:#667086;letter-spacing:1.4px;padding-left:16px">BILLING &amp; ACCESS</span></td></tr>' +
    '<tr><td style="background:#ffffff;border:1px solid #e1e3e9;border-top:3px solid #112d94;border-radius:0 0 12px 12px;padding:36px 28px">' +
    '<p style="margin:0 0 18px;font-size:10px;font-weight:600;letter-spacing:1.5px;color:#112d94;text-transform:uppercase">' + (isAuth ? 'Account access' : 'Workspace update') + '</p>' +
    '<h1 style="margin:0 0 18px;font:normal 34px/1.15 Georgia,serif;letter-spacing:-1px;color:#1d2433">' + escape(payload.title) + '</h1>' +
    '<p style="margin:0;font-size:15px;line-height:1.8;color:#667086;white-space:pre-line">' + escape(payload.body) + '</p>' +
    (code ? '<div style="margin:28px 0;padding:24px 12px;background:#f4f5f9;border:1px solid #e1e3e9;border-radius:8px;text-align:center"><span style="font:32px/1.4 monospace;letter-spacing:8px;color:#112d94">' + escape(code) + '</span></div><p style="font-size:12px;line-height:1.7;color:#667086">Enter this code in the window where you started. It expires in 10 minutes.</p>' : cta) +
    (rows ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-collapse:collapse">' + rows + '</table>' : '') +
    '<div style="margin-top:28px;padding-top:20px;border-top:1px solid #e1e3e9;font-size:11px;line-height:1.8;color:#667086">' + escape(footer) + '</div></td></tr>' +
    '<tr><td style="padding:22px 8px;font-size:11px;line-height:1.8;color:#667086">Bagseven &middot; Payments, subscriptions and access on Avalanche.' +
    (isAuth ? '<br>If you did not request this email, you can ignore it.' : '') +
    (!code ? '<br><br>Button not working? Copy this link into your browser:<br><a href="' + escape(href) + '" style="color:#112d94;word-break:break-all">' + escape(href) + '</a>' : '') +
    '</td></tr></table></td></tr></table></body></html>';
  const meta = Object.entries(payload.meta ?? {}).filter(([key, value]) => !['code', 'purpose', 'next'].includes(key) && value != null).map(([key, value]) => (labels[key] ?? key) + ': ' + value).join('\n');
  return { html, text: [payload.title, payload.body, code ? 'Verification code: ' + code + '\nExpires in 10 minutes.' : action + ': ' + href, meta, footer].filter(Boolean).join('\n\n') };
}
