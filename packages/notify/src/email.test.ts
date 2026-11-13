import { describe, expect, it } from 'vitest';
import { renderNotificationEmail } from './email.js';
import type { NotifyPayload } from './index.js';
const message: NotifyPayload = { to: 'customer@example.com', event: 'magic_link', title: 'Your workspace awaits.', body: 'Sign in within 15 minutes.' };
describe('shared branded notification emails', () => {
  it('escapes untrusted copy and metadata and preserves a functional query-string action', () => {
    const result = renderNotificationEmail({ ...message, title: '<script>title</script>', body: '<img src=x onerror=alert(1)>', meta: { '<b>': '<svg onload=bad>' } }, 'https://console.example.com/callback?token=a&next=b');
    expect(result.html).not.toContain('<script>'); expect(result.html).not.toContain('<img'); expect(result.html).not.toContain('<svg');
    expect(result.html).toContain('&lt;script&gt;'); expect(result.html).toContain('token=a&amp;next=b');
    expect(result.text).toContain('https://console.example.com/callback?token=a&next=b');
  });
  it('gives verification codes their own block without a misleading sign-in action', () => {
    const result = renderNotificationEmail({ ...message, code: '123456', body: 'Return to the window where you started.' }, 'https://console.example.com/app');
    expect(result.html).toContain('123456'); expect(result.html).not.toContain('href=');
    expect(result.html).toContain('expires in 10 minutes'); expect(result.text).toContain('Verification code: 123456');
  });
  it('rejects executable or credential-bearing action URLs and malformed codes', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.com']) expect(() => renderNotificationEmail(message, url)).toThrow('Invalid email action URL');
    expect(() => renderNotificationEmail({ ...message, code: '<script>' }, 'https://example.com')).toThrow('Invalid email verification code');
  });
  it('keeps internal auth metadata out of the visible message', () => {
    const result = renderNotificationEmail({ ...message, meta: { next: '/private', purpose: 'magic', remaining: 10 } }, 'https://example.com');
    expect(result.html).not.toContain('/private'); expect(result.html).toContain('Credits remaining');
  });
});
