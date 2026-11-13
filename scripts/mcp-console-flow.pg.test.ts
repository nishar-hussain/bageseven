import express from 'express';
import type { Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createDb, AccountProfiles, McpConsoleConsent } from '@bagseven/db';
const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('console session -> OAuth -> MCP flow (isolated PostgreSQL schema)', () => {
  const schema = 'mcp_flow_' + randomUUID().replaceAll('-', '');
  let admin: ReturnType<typeof createDb>, db: ReturnType<typeof createDb>, server: Server, base: string;
  let mount: typeof import('./mcp-oauth-as')['mountMcpOAuth'];
  let verify: typeof import('./mcp-oauth-as')['verifyMcpAccessToken'];
  const verifier = 'v'.repeat(64);
  const email = 'fixture@example.com', wallet = '0x' + '11'.repeat(20);
  beforeAll(async () => {
    admin = createDb({ connectionString: databaseUrl! }); await admin.$client.query('create schema ' + schema);
    const isolated = new URL(databaseUrl!); isolated.searchParams.set('options', '-csearch_path=' + schema);
    db = createDb({ connectionString: isolated.href });
    await db.$client.query('create table auth_credentials(key text primary key,data jsonb not null,expires_at timestamptz not null); create table account_profiles(email text primary key,wallet_address text,onboarding_done_at bigint,updated_at timestamptz not null default now())');
    await new AccountProfiles(db).bind(email, null, wallet);
    vi.stubEnv('DATABASE_URL', isolated.href); vi.stubEnv('CONSOLE_URL', 'http://localhost:3000'); vi.stubEnv('MCP_AUTH_TOKEN', ''); vi.stubEnv('MCP_OAUTH_CLIENT_SECRET', '');
    const oauth = await import('./mcp-oauth-as'); mount = oauth.mountMcpOAuth; verify = oauth.verifyMcpAccessToken;
    const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false })); mount(app);
    server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; vi.stubEnv('BAGSEVEN_MCP_PUBLIC_URL', base);
  });
  afterAll(async () => { vi.unstubAllEnvs(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await db?.$client.end(); if (admin) { await admin.$client.query('drop schema ' + schema + ' cascade'); await admin.$client.end(); } });
  const query = () => new URLSearchParams({ client_id: 'chatgpt-test', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', state: 'original-state', scope: 'bagseven', resource: base + '/mcp', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  async function prepare() {
    const response = await fetch(base + '/oauth/authorize?' + query(), { redirect: 'manual' });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!); expect(location.origin).toBe('http://localhost:3000'); expect(location.pathname).toBe('/app/mcp/authorize');
    const id = location.searchParams.get('request')!, cookie = response.headers.get('set-cookie')!.split(';')[0];
    // Test fixture models the already-tested authenticated console approval route.
    const proof = await new McpConsoleConsent(db).approve(id, email, wallet);
    return { proof, cookie };
  }
  it('reuses the verified console identity, preserves state and PKCE, and issues refreshable account tokens', async () => {
    const { proof, cookie } = await prepare();
    const missingCookie = await fetch(base + '/oauth/account/console?code=' + proof.code, { redirect: 'manual' }); expect(missingCookie.status).toBe(400);
    const callback = await fetch(base + '/oauth/account/console?code=' + proof.code, { headers: { cookie }, redirect: 'manual' });
    expect(callback.status).toBe(302);
    const target = new URL(callback.headers.get('location')!); expect(target.origin).toBe('https://chatgpt.com'); expect(target.searchParams.get('state')).toBe('original-state'); expect(target.searchParams.get('iss')).toBe(base);
    const exchange = (code_verifier: string) => fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code: target.searchParams.get('code'), code_verifier, client_id: 'chatgpt-test', redirect_uri: query().get('redirect_uri'), resource: base + '/mcp' }) });
    expect((await exchange('wrong-verifier')).status).toBe(400);
    const tokenResponse = await exchange(verifier); expect(tokenResponse.status).toBe(200); const tokens = await tokenResponse.json();
    expect(await verify('Bearer ' + tokens.access_token)).toMatchObject({ humanId: email, accountWallet: wallet, resource: base + '/mcp' });
    expect((await exchange(verifier)).status).toBe(400);
    expect((await fetch(base + '/oauth/account/console?code=' + proof.code, { headers: { cookie }, redirect: 'manual' })).status).toBe(400);
    vi.stubEnv('BAGSEVEN_MCP_PUBLIC_URL', 'https://another-issuer.example'); expect(await verify('Bearer ' + tokens.access_token)).toBeNull(); vi.stubEnv('BAGSEVEN_MCP_PUBLIC_URL', base);
    const refresh = await fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'chatgpt-test' }) }); expect(refresh.status).toBe(200);
  });
  it('refuses consent when the durable linked wallet changes before callback', async () => {
    const { proof, cookie } = await prepare(); await new AccountProfiles(db).bind(email, wallet, '0x' + '22'.repeat(20));
    const response = await fetch(base + '/oauth/account/console?code=' + proof.code, { headers: { cookie }, redirect: 'manual' }); expect(response.status).toBe(400); expect(response.headers.get('location')).toBeNull();
  });
});
