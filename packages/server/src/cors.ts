/** CORS permits hosted clients; service Bearer tokens still authorize requests. */
export function isCorsOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return true; // Server-to-server requests do not carry Origin.
  const configured = (env.CORS_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (configured.includes('*')) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.username || url.password) return false;
  if (configured.includes(origin)) return true;
  for (const value of [env.NEXT_PUBLIC_CONSOLE_URL, env.NEXT_PUBLIC_LANDING_URL]) {
    try {
      if (value && new URL(value).origin === origin) return true;
    } catch {
      // An invalid optional URL must not break preflight requests.
    }
  }
  if (url.protocol === 'https:' && !url.port &&
      (url.hostname.endsWith('.vercel.app') || url.hostname.endsWith('.railway.app'))) return true;
  return env.NODE_ENV !== 'production' && url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
