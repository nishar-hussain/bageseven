/**
 * Bagseven MCP OAuth Authorization Server (ChatGPT custom MCP).
 *
 * ChatGPT cannot use World as its IdP directly (redirect URI must be ChatGPT’s).
 * Flow: ChatGPT → Bagseven AS authorize → human proves World Agent Pass (or mock)
 * → Bagseven issues access_token → ChatGPT calls /mcp with Bearer.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { verifyWorldAgentPass } from '@bagseven/world';

type AuthCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scope: string;
  resource?: string;
  humanId: string;
  worldProofId: string;
  exp: number;
};

type AccessToken = {
  humanId: string;
  worldProofId: string;
  clientId: string;
  scope: string;
  resource?: string;
  exp: number;
};

const codes = new Map<string, AuthCode>();
const tokens = new Map<string, AccessToken>();

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

function prune(): void {
  const now = Date.now();
  for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
  for (const [k, v] of tokens) if (v.exp < now) tokens.delete(k);
}

export function verifyMcpAccessToken(authHeader: string | undefined): AccessToken | null {
  prune();
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  // Legacy static token still accepted when set.
  if (process.env.MCP_AUTH_TOKEN && safeEqual(token, process.env.MCP_AUTH_TOKEN)) {
    return {
      humanId: 'static-token',
      worldProofId: 'world:ok:static-token',
      clientId: 'static',
      scope: 'bagseven',
      exp: Date.now() + 86_400_000,
    };
  }
  const row = tokens.get(token);
  if (!row || row.exp < Date.now()) return null;
  return row;
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
  .err{background:#fff1f1;color:#9b1c1c;padding:.75rem;border-radius:12px;font-size:.85rem}
  code{font-size:.75rem;background:#f6f6f8;padding:.1rem .35rem;border-radius:6px}
</style></head><body>
  <div class="card">
    <h1>Authorize Bagseven for ChatGPT</h1>
    <p>World verifies <strong>you</strong>. ChatGPT then receives a Bagseven access token for MCP tools (status, grants, paid_run). Agents never hold World credentials.</p>
    ${opts.error ? `<p class="err">${opts.error}</p>` : ''}
    <form method="post" action="/oauth/authorize?${q.toString()}">
      <label>Email / holder</label>
      <input name="holder" required placeholder="you@company.com" />
      <label>World proof (mock) or leave blank if pasting id_token</label>
      <input name="world_proof_id" placeholder="world:ok:you@company.com" />
      <label>World id_token (live Agent Pass — optional)</label>
      <textarea name="id_token" rows="4" placeholder="Paste OIDC id_token when using live World"></textarea>
      <button type="submit">Continue with World gate</button>
    </form>
    <p style="margin-top:1rem;font-size:.75rem">Resource: <code>${opts.resource || resourceUrl(opts.base)}</code></p>
  </div>
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

    const body = req.body as {
      holder?: string;
      world_proof_id?: string;
      id_token?: string;
    };
    const holder = (body.holder || '').trim();
    const proof = (body.world_proof_id || '').trim() || (holder ? `world:ok:${holder}` : '');
    const idToken = (body.id_token || '').trim() || undefined;

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

    if (!holder) return fail('Holder email is required');
    const okRedirect =
      redirect_uri.startsWith('https://chatgpt.com/') ||
      redirect_uri.startsWith('https://chat.openai.com/') ||
      redirect_uri.startsWith('http://127.0.0.1') ||
      redirect_uri.startsWith('http://localhost');
    if (!okRedirect) {
      return fail('redirect_uri must be a ChatGPT connector callback (or local inspector)');
    }

    const verified = await verifyWorldAgentPass({
      world_proof_id: proof || undefined,
      id_token: idToken,
      holder,
    });
    if (!verified.ok) {
      return fail(`World gate failed: ${verified.detail}`);
    }

    prune();
    const code = b64url(randomBytes(24));
    codes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      scope,
      resource,
      humanId: verified.human_id,
      worldProofId: verified.world_proof_id,
      exp: Date.now() + 10 * 60_000,
    });

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    redirect.searchParams.set('iss', base);
    res.redirect(302, redirect.toString());
  });

  app.post('/oauth/token', (req, res) => {
    prune();
    const body = req.body as Record<string, string>;
    const grant = body.grant_type;
    if (grant !== 'authorization_code') {
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
    if (expectedSecret && cid === expectedId && csec && !safeEqual(csec, expectedSecret)) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    const row = codes.get(body.code || '');
    if (!row || row.exp < Date.now()) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    codes.delete(body.code);

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
    tokens.set(access, {
      humanId: row.humanId,
      worldProofId: row.worldProofId,
      clientId: row.clientId || cid,
      scope: row.scope,
      resource: row.resource,
      exp: Date.now() + expiresIn * 1000,
    });
    // refresh reuse map: store under refresh key pointing at same identity
    tokens.set(`refresh:${refresh}`, {
      humanId: row.humanId,
      worldProofId: row.worldProofId,
      clientId: row.clientId || cid,
      scope: row.scope,
      resource: row.resource,
      exp: Date.now() + 30 * 86_400_000,
    });

    res.json({
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
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });
}

export function oauthChallenge(base: string): string {
  return `Bearer realm="bagseven", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
}

export function requireMcpOAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  publicUrl: string,
): void {
  const tok = verifyMcpAccessToken(req.headers.authorization);
  if (tok) {
    (req as Request & { bagsevenAuth?: AccessToken }).bagsevenAuth = tok;
    next();
    return;
  }
  res.setHeader('WWW-Authenticate', oauthChallenge(publicUrl.replace(/\/$/, '')));
  res.status(401).json({
    error: 'unauthorized',
    message: 'Bearer access token required. Complete ChatGPT OAuth (World gate) first.',
  });
}
