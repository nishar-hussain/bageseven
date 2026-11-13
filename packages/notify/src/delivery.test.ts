import { afterEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => ({ data: { id: 'test-delivery' }, error: null })));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
import { sendNotify } from './index.js';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('uses the configured server console URL and delivers matching HTML and plain text', async () => {
  vi.stubEnv('RESEND_API_KEY', 'unit-test-key'); vi.stubEnv('NOTIFY_MODE', 'send');
  vi.stubEnv('CONSOLE_URL', 'https://console.example.com/');
  vi.stubEnv('NEXT_PUBLIC_CONSOLE_URL', 'http://localhost:3000');
  await sendNotify({ to: 'preview@example.com', event: 'grant_minted', title: 'Access is ready', body: 'Your plan is available.' });
  expect(send).toHaveBeenCalledOnce();
  const message = send.mock.calls[0]![0];
  expect(message.html).toContain('https://console.example.com/app');
  expect(message.text).toContain('https://console.example.com/app');
  expect(message.html).not.toContain('http://localhost');
});
