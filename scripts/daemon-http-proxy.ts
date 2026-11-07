import type { Request, Response, NextFunction } from 'express';

/** Internal routing only. The daemon still authenticates every protected request. */
export function daemonHttpProxy(base: string) {
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Embedded daemon proxy must target a local HTTP origin');
  }
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/internal/') && !req.path.startsWith('/v1/')) return next();
    const headers = new Headers();
    const excluded = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'expect', 'upgrade']);
    for (const [key, value] of Object.entries(req.headers)) {
      if (!excluded.has(key) && value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    // Service credentials are deliberately never added here.
    const body = ['GET', 'HEAD'].includes(req.method) || req.body === undefined ? undefined : JSON.stringify(req.body);
    if (body !== undefined) headers.set('content-type', 'application/json');
    try {
      const response = await fetch(`${origin.origin}${req.originalUrl}`, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      res.status(response.status);
      for (const [key, value] of response.headers) {
        if (!['connection', 'transfer-encoding', 'content-length', 'content-encoding'].includes(key)) res.setHeader(key, value);
      }
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.status(502).json({ error: { code: 'DAEMON_UNAVAILABLE', message: 'The local daemon is unavailable' } });
    }
  };
}
