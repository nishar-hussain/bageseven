/**
 * Bagseven MCP OAuth Authorization Server (ChatGPT custom MCP).
 *
 * Email and signed Avalanche wallet ownership approve the connection.
 * Bagseven issues access_token → ChatGPT calls /mcp with Bearer.
 */
import { mcpCredentials } from './mcp-credential-store.ts';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { accountConsentMarkup, startAccountConsent, finishAccountConsent } from './mcp-account-auth.ts';

type AuthCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scope: string;
  resource?: string;
  humanId: string;
  accountWallet: string;
  exp: number;
};

type AccessToken = {
  humanId: string;
  accountWallet: string;
  clientId: string;
  scope: string;
  resource?: string;
  exp: number;
};

const credentials = mcpCredentials<AuthCode | AccessToken>('oauth');
const codes = {
  get: async (key: string) => await credentials.get(`code:${key}`) as AuthCode | undefined,
  set: (key: string, row: AuthCode) => credentials.set(`code:${key}`, row),
};
const tokens = credentials;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function publicBase(req: Request): string {
  const fromEnv = process.env.BAGSEVEN_MCP_PUBLIC_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function clientId(): string {
  return process.env.MCP_OAUTH_CLIENT_ID?.trim() || 'bagseven-chatgpt';
}

function clientSecret(): string {
  return process.env.MCP_OAUTH_CLIENT_SECRET?.trim() || '';
}

function resourceUrl(base: string): string {
  return `${base}/mcp`;
}

let nextPrune = 0;
async function prune() {
  if (Date.now() < nextPrune) return;
  nextPrune = Date.now() + 15000;
  await credentials.prune();
}

export async function verifyMcpAccessToken(authHeader: string | undefined): Promise<AccessToken | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (process.env.MCP_AUTH_TOKEN && safeEqual(token, process.env.MCP_AUTH_TOKEN)) {
    return { humanId: 'static-token', accountWallet: 'operator:static-token', clientId: 'static', scope: 'bagseven', exp: Date.now() + 86400000 };
  }
  if (token.startsWith('refresh:') || token.startsWith('code:')) return null;
  const row = await tokens.get(token) as AccessToken | undefined;
  return row && row.exp > Date.now() ? row : null;
}

function html(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function authorizePage(opts: {
  base: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  error?: string;
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scope,
    response_type: 'code',
  });
  if (opts.resource) q.set('resource', opts.resource);
  if (opts.codeChallenge) q.set('code_challenge', opts.codeChallenge);
  if (opts.codeChallengeMethod) q.set('code_challenge_method', opts.codeChallengeMethod);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Bagseven · Authorize ChatGPT</title>
<style>
  body{font-family:ui-sans-serif,system-ui;background:#f2f2f2;color:#0e0e10;margin:0;padding:2rem}
  .card{max-width:28rem;margin:2rem auto;background:#fff;border:1px solid #ececf0;border-radius:16px;padding:1.5rem;box-shadow:0 18px 40px -18px #0e0e102e}
  h1{font-size:1.35rem;margin:0 0 .5rem} p{color:#63636d;font-size:.9rem;line-height:1.45}
  label{display:block;font-size:.7rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#63636d;margin-top:1rem}
  input,textarea{width:100%;margin-top:.4rem;padding:.7rem .8rem;border:1px solid #ececf0;border-radius:12px;font:inherit;box-sizing:border-box}
  button{margin-top:1.25rem;width:100%;border:0;border-radius:999px;background:#0e0e10;color:#fff;font-weight:600;padding:.75rem;cursor:pointer}
  button:disabled{opacity:.65;cursor:wait}
  .qr-panel:not([hidden]){display:grid;justify-items:center;margin:1rem 0;padding:1rem;border:1px solid #ececf0;border-radius:12px;background:white}
  .qr-panel img{display:block;width:320px;max-width:100%;height:auto}
  .qr-panel p{margin:.5rem 0 0;text-align:center}
  .err{background:#fff1f1;color:#9b1c1c;padding:.75rem;border-radius:12px;font-size:.85rem}
  code{font-size:.75rem;background:#f6f6f8;padding:.1rem .35rem;border-radius:6px}
</style></head><body>
  <div class="card">
    <h1>Authorize Bagseven for ChatGPT</h1>
    ${accountConsentMarkup}

</body></html>`;
}

export function mountMcpOAuth(app: Express): void {
  const asMeta = (req: Request, res: Response) => {
    const base = publicBase(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['openid', 'bagseven', 'bagseven:tools'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: false,
    });
  };

  const prMeta = (req: Request, res: Response) => {
    const base = publicBase(req);
    res.json({
      resource: resourceUrl(base),
      authorization_servers: [base],
      scopes_supported: ['bagseven', 'bagseven:tools'],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://github.com/',
    });
  };

  app.get('/.well-known/oauth-authorization-server', asMeta);
  app.get('/.well-known/openid-configuration', asMeta);
  app.get('/.well-known/oauth-protected-resource', prMeta);
  app.get('/.well-known/oauth-protected-resource/mcp', prMeta);

  app.post('/oauth/account/challenge', (req, res) => startAccountConsent(req, res, publicBase(req)));

  app.get('/oauth/authorize', (req, res) => {
    const base = publicBase(req);
    const client_id = String(req.query.client_id || '');
    const redirect_uri = String(req.query.redirect_uri || '');
    const state = String(req.query.state || '');
    const scope = String(req.query.scope || 'bagseven');
    const resource = req.query.resource ? String(req.query.resource) : resourceUrl(base);
    const code_challenge = req.query.code_challenge ? String(req.query.code_challenge) : undefined;
    const code_challenge_method = req.query.code_challenge_method
      ? String(req.query.code_challenge_method)
      : undefined;

    if (!client_id || !redirect_uri) {
      res.status(400).send('missing client_id or redirect_uri');
      return;
    }
    // Accept ChatGPT’s dynamic client id or our configured client.
    res.type('html').send(
      authorizePage({
        base,
        clientId: client_id,
        redirectUri: redirect_uri,
        state,
        scope,
        resource,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
      }),
    );
  });

  app.post('/oauth/authorize', async (req, res) => {
    const base = publicBase(req);
    const q = req.query;
    const client_id = String(q.client_id || '');
    const redirect_uri = String(q.redirect_uri || '');
    const state = String(q.state || '');
    const scope = String(q.scope || 'bagseven');
    const resource = q.resource ? String(q.resource) : resourceUrl(base);
    const code_challenge = q.code_challenge ? String(q.code_challenge) : undefined;
    const code_challenge_method = q.code_challenge_method ? String(q.code_challenge_method) : undefined;


    const fail = (msg: string) => {
      res
        .status(400)
        .type('html')
        .send(
          authorizePage({
            base,
            clientId: client_id,
            redirectUri: redirect_uri,
            state,
            scope,
            resource,
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge_method,
            error: msg,
          }),
        );
    };

    let okRedirect = false;
    try {
      const target = new URL(redirect_uri);
      okRedirect = (target.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(target.hostname)) ||
        (target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname));
    } catch { /* Invalid redirect URLs are refused. */ }
    if (!okRedirect) {
      return fail('redirect_uri must be a ChatGPT connector callback (or local inspector)');
    }

    let humanId: string;
    let accountWallet: string;
    try {
      const consent = await finishAccountConsent(req, res, base);
      humanId = consent.accountId; accountWallet = consent.wallet;
    } catch (error) { return fail(error instanceof Error ? error.message : 'Account verification failed'); }

    await prune();
    const code = b64url(randomBytes(24));
    await codes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      scope,
      resource,
      humanId,
      accountWallet,
      exp: Date.now() + 10 * 60_000,
    });

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    redirect.searchParams.set('iss', base);
    res.redirect(302, redirect.toString());
  });

  app.post('/oauth/token', async (req, res) => {
    await prune();
    const body = req.body as Record<string, string>;
    const grant = body.grant_type;
    if (grant !== 'authorization_code' && grant !== 'refresh_token') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }

    const authHeader = req.headers.authorization;
    let cid = body.client_id || '';
    let csec = body.client_secret || '';
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      cid = decoded.slice(0, i);
      csec = decoded.slice(i + 1);
    }

    const expectedId = clientId();
    const expectedSecret = clientSecret();
    // Accept our registered client when secret configured; otherwise public PKCE clients (ChatGPT).
    if (expectedSecret && cid === expectedId && !safeEqual(csec, expectedSecret)) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant === 'refresh_token') {
      const key = `refresh:${body.refresh_token || ''}`;
      const previous = await tokens.get(key) as AccessToken | undefined;
      if (!previous || previous.exp < Date.now() || previous.clientId !== cid ||
          (body.resource && body.resource !== previous.resource) ||
          (body.scope && body.scope !== previous.scope)) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      const access = b64url(randomBytes(32));
      const refresh = b64url(randomBytes(32));
      if (!await credentials.exchange(key, [
        { key: access, data: { ...previous, exp: Date.now() + 3600000 } },
        { key: `refresh:${refresh}`, data: { ...previous, exp: Date.now() + 30 * 86400000 } },
      ])) { res.status(400).json({ error: 'invalid_grant' }); return; }
      res.set('Cache-Control', 'no-store').json({ access_token: access, token_type: 'Bearer',
        expires_in: 3600, refresh_token: refresh, scope: previous.scope });
      return;
    }

    const row = await codes.get(body.code || '');
    if (!row || row.exp < Date.now() || row.clientId !== cid) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    if (row.redirectUri !== body.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }
    if (row.codeChallenge) {
      const method = (row.codeChallengeMethod || 'S256').toUpperCase();
      const verifier = body.code_verifier || '';
      if (method === 'S256') {
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (challenge !== row.codeChallenge) {
          res.status(400).json({ error: 'invalid_grant', error_description: 'pkce failed' });
          return;
        }
      } else if (method === 'PLAIN') {
        if (verifier !== row.codeChallenge) {
          res.status(400).json({ error: 'invalid_grant', error_description: 'pkce failed' });
          return;
        }
      } else {
        res.status(400).json({ error: 'invalid_request', error_description: `unsupported code_challenge_method ${method}` });
        return;
      }
    }

    const access = b64url(randomBytes(32));
    const refresh = b64url(randomBytes(32));
    const expiresIn = 3600;
    const identity = { humanId: row.humanId, accountWallet: row.accountWallet,
      clientId: row.clientId || cid, scope: row.scope, resource: row.resource };
    if (!await credentials.exchange(`code:${body.code}`, [
      { key: access, data: { ...identity, exp: Date.now() + expiresIn * 1000 } },
      { key: `refresh:${refresh}`, data: { ...identity, exp: Date.now() + 30 * 86400000 } },
    ])) { res.status(400).json({ error: 'invalid_grant' }); return; }

    res.set('Cache-Control', 'no-store').json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refresh,
      scope: row.scope,
    });
  });

  // Minimal DCR so ChatGPT can register if enabled later.
  app.post('/oauth/register', (req, res) => {
    const body = (req.body || {}) as { redirect_uris?: string[]; client_name?: string };
    const id = `dyn_${randomUUID()}`;
    res.status(201).json({
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret: b64url(randomBytes(18)),
      redirect_uris: body.redirect_uris || [],
      client_name: body.client_name || 'ChatGPT',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });
}

export function oauthChallenge(base: string): string {
  return `Bearer realm="bagseven", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
}
