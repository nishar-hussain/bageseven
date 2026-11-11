/**
 * Bagseven MCP OAuth Authorization Server (ChatGPT custom MCP).
 *
 * ChatGPT cannot use World as its IdP directly (redirect URI must be ChatGPT’s).
 * Flow: ChatGPT → Bagseven AS authorize → human proves World IDKit or World Agent Pass
 * → Bagseven issues access_token → ChatGPT calls /mcp with Bearer.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import QRCode from 'qrcode';
import { verifyWorldAgentPass } from '@bagseven/world';
import { readWorldContinuity, signWorldContinuity, WORLD_CONTINUITY_AGE } from '../apps/console/lib/world-continuity.ts';

const WORLD_SESSION_COOKIE = 'bagseven_oauth_world_session';
function savedWorldSession(req: Request): string | undefined {
  const value = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${WORLD_SESSION_COOKIE}=`))?.slice(WORLD_SESSION_COOKIE.length + 1);
  try { return readWorldContinuity(value ? decodeURIComponent(value) : undefined); } catch { return undefined; }
}

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
      worldProofId: 'operator:static-token',
      clientId: 'static',
      scope: 'bagseven',
      exp: Date.now() + 86_400_000,
    };
  }
  // Refresh credentials are accepted only by the token endpoint.
  if (token.startsWith('refresh:')) return null;
  const row = tokens.get(token);
  if (!row || row.exp < Date.now()) return null;
  return row;
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
    <p>Verify with World ID to approve this agent connection. The agent receives a Bagseven token; your World credentials stay with you.</p>
    ${opts.error ? `<p class="err">${html(opts.error)}</p>` : ''}
    <form method="post" action="/oauth/authorize?${html(q.toString())}">
      <input type="hidden" name="idkit_response" id="world-proof" />
      <button type="button" id="verify-world">Verify with World ID</button>
      <div id="world-qr-panel" class="qr-panel" hidden>
        <img id="world-qr" width="320" height="320" alt="Scan this QR code with World App to authorize Bagseven" />
        <p>Scan with World App on your phone</p>
      </div>
      <a id="world-link" hidden>Open World App</a>
      <p id="world-status" role="status"></p>
    </form>
    <p style="margin-top:1rem;font-size:.75rem">Resource: <code>${html(opts.resource || resourceUrl(opts.base))}</code></p>
  </div>
<script src="https://cdn.jsdelivr.net/npm/@worldcoin/idkit-core@4.6.0/dist/idkit.global.js"></script>
<script>
 document.getElementById('verify-world').onclick = async function () {
  this.disabled = true;
  const status = document.getElementById('world-status');
  const qrPanel = document.getElementById('world-qr-panel');
  const qr = document.getElementById('world-qr');
  qrPanel.hidden = true;
  document.getElementById('world-link').hidden = true;
  try {
   status.textContent = 'Starting World ID verification…';
   const response = await fetch('/oauth/world/challenge', { method: 'POST' });
   const sig = await response.json();
   if (!response.ok) throw new Error(sig.error || 'World ID is unavailable');
   const config = { app_id: sig.app_id, environment: sig.environment,
    rp_context: { rp_id: sig.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig } };
   const builder = sig.existing_session_id ? IDKit.proveSession(sig.existing_session_id, config) : IDKit.createSession(config);
   const request = await builder.constraints(IDKit.CredentialRequest('proof_of_human'));
   const link = document.getElementById('world-link'); link.href = request.connectorURI; link.hidden = false;
   const qrResponse = await fetch('/oauth/world/qr', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri: request.connectorURI, nonce: sig.nonce }) });
   if (!qrResponse.ok) throw new Error('Could not generate the QR code. Try again, or use Open World App on your phone.');
   const qrUrl = URL.createObjectURL(await qrResponse.blob());
   qr.onload = function () { URL.revokeObjectURL(qrUrl); };
   qr.src = qrUrl; qrPanel.hidden = false;
   status.textContent = 'Scan the QR code with World App, then approve on your phone.';
   const completion = await request.pollUntilCompletion();
   if (!completion.success) throw new Error('World ID verification failed (' + completion.error + '). Please try a fresh QR.');
   document.getElementById('world-proof').value = JSON.stringify(completion.result);
   document.querySelector('form').submit();
  } catch (error) { qrPanel.hidden = true; status.textContent = error.message; this.disabled = false; }
 };
</script>
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

  /** Encode the connector locally; verification links never go to a third-party QR service. */
  app.post('/oauth/world/qr', async (req, res) => {
    const nonce = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('bagseven_oauth_world_nonce='))?.slice('bagseven_oauth_world_nonce='.length);
    if (req.headers.origin !== publicBase(req) || !nonce || req.body?.nonce !== nonce) {
      res.status(403).json({ error: 'Start a new World verification in this browser' }); return;
    }
    const uri = req.body?.uri;
    if (typeof uri !== 'string' || uri.length > 4096) { res.status(400).json({ error: 'Invalid World connector URL' }); return; }
    try {
      const url = new URL(uri);
      if (url.protocol !== 'https:' || !['world.org', 'staging.world.org', 'sandbox.world.org'].includes(url.hostname) || url.pathname !== '/verify' || url.username || url.password) {
        res.status(400).json({ error: 'Invalid World connector URL' }); return;
      }
      const png = await QRCode.toBuffer(uri, { type: 'png', width: 320, margin: 4, errorCorrectionLevel: 'M' });
      res.setHeader('Cache-Control', 'no-store');
      res.type('image/png').send(png);
    } catch { res.status(400).json({ error: 'Could not generate World QR code' }); }
  });

  app.post('/oauth/world/challenge', async (req, res) => {
    try {
      const daemon = (process.env.DAEMON_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
      const response = await fetch(`${daemon}/internal/world/rp-signature`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DAEMON_AUTH_TOKEN || ''}` },
        body: JSON.stringify({ purpose: 'session', existing_session_id: savedWorldSession(req) }), signal: AbortSignal.timeout(10000),
      });
      const sig = await response.json() as { nonce?: string };
      if (!response.ok || !sig.nonce) { res.status(503).json({ error: 'World ID signing credentials are not ready' }); return; }
      res.cookie('bagseven_oauth_world_nonce', sig.nonce, { httpOnly: true, sameSite: 'lax', secure: publicBase(req).startsWith('https:'), path: '/oauth', maxAge: 300000 });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...sig, existing_session_id: savedWorldSession(req) });
    } catch { res.status(503).json({ error: 'World verification is unavailable' }); }
  });

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
      idkit_response?: string;
      id_token?: string;
    };
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
    let worldProofId: string;
    if (body.idkit_response) {
      try {
        const proof = JSON.parse(body.idkit_response) as { nonce?: string; session_id?: string; action?: string };
        if (!proof.session_id || proof.action) return fail('Complete a fresh World session verification');
        const cookie = req.headers.cookie?.split(';').map((v) => v.trim()).find((v) => v.startsWith('bagseven_oauth_world_nonce='))?.slice('bagseven_oauth_world_nonce='.length);
        if (!cookie || decodeURIComponent(cookie) !== proof.nonce) return fail('World verification does not match this browser request');
        const daemon = (process.env.DAEMON_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
        const response = await fetch(`${daemon}/internal/world/verify-idkit-session`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DAEMON_AUTH_TOKEN || ''}` },
          body: JSON.stringify({ idkit_response: proof }), signal: AbortSignal.timeout(20000),
        });
        const verified = await response.json() as { ok?: boolean; human_id?: string; world_proof_id?: string; session_id?: string };
        if (!response.ok || !verified.ok || !verified.human_id || !verified.world_proof_id) return fail('World ID verification failed');
        if (verified.session_id !== proof.session_id || (savedWorldSession(req) && verified.session_id !== savedWorldSession(req))) return fail('World session does not match this account');
        res.cookie(WORLD_SESSION_COOKIE, signWorldContinuity(verified.session_id), { httpOnly: true, sameSite: 'lax', secure: publicBase(req).startsWith('https:'), path: '/oauth', maxAge: WORLD_CONTINUITY_AGE * 1000 });
        humanId = verified.human_id;
        worldProofId = verified.world_proof_id;
        res.clearCookie('bagseven_oauth_world_nonce', { path: '/oauth' });
      } catch { return fail('World verification is unavailable or the proof is invalid'); }
    } else if (idToken) {
      const verified = await verifyWorldAgentPass({ id_token: idToken });
      if (!verified.ok || verified.mode !== 'live') return fail('A verified World identity is required');
      humanId = verified.human_id;
      worldProofId = verified.world_proof_id;
    } else {
      return fail('Complete World ID verification before authorizing an agent');
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
      humanId,
      worldProofId,
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
      const previous = tokens.get(key);
      if (!previous || previous.exp < Date.now() || previous.clientId !== cid ||
          (body.resource && body.resource !== previous.resource) ||
          (body.scope && body.scope !== previous.scope)) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      tokens.delete(key);
      const access = b64url(randomBytes(32));
      const refresh = b64url(randomBytes(32));
      tokens.set(access, { ...previous, exp: Date.now() + 3600_000 });
      tokens.set(`refresh:${refresh}`, { ...previous, exp: Date.now() + 30 * 86_400_000 });
      res.set('Cache-Control', 'no-store').json({ access_token: access, token_type: 'Bearer',
        expires_in: 3600, refresh_token: refresh, scope: previous.scope });
      return;
    }

    const row = codes.get(body.code || '');
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

    codes.delete(body.code);
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
