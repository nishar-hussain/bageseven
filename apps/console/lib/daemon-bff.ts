/** Server-only daemon proxy helpers for Next BFF routes. */

export function daemonBase(): string {
  return (process.env.DAEMON_URL ?? 'http://127.0.0.1:4001').replace(/\/$/, '');
}

export function daemonAuthHeaders(): HeadersInit {
  const token = process.env.DAEMON_AUTH_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function daemonFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const auth = daemonAuthHeaders();
  for (const [k, v] of Object.entries(auth)) headers.set(k, v as string);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${daemonBase()}${path}`, { ...init, headers, cache: 'no-store' });
}

export async function daemonJson<T = unknown>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await daemonFetch(path, init);
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = { raw: text } as T;
  }
  return { ok: res.ok, status: res.status, body };
}
