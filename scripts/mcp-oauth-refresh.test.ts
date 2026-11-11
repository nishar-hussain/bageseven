import express from 'express';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@bagseven/world',()=>({verifyWorldAgentPass:async()=>({ok:true,mode:'live',human_id:'verified-test-human',world_proof_id:'verified-test-proof'})}));
import { mountMcpOAuth, verifyMcpAccessToken } from './mcp-oauth-as';
let server:Server;let base:string;
beforeAll(async()=>{const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));mountMcpOAuth(app);server=await new Promise<Server>(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const address=server.address();if(!address||typeof address==='string')throw Error('No listener');base=`http://127.0.0.1:${address.port}`;vi.stubEnv('BAGSEVEN_MCP_PUBLIC_URL',base);vi.stubEnv('MCP_OAUTH_CLIENT_SECRET','');});
afterAll(async()=>{vi.unstubAllEnvs();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
async function code(){const verifier='test-verifier-'.repeat(4);const query=new URLSearchParams({client_id:'test-client',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});const res=await fetch(`${base}/oauth/authorize?${query}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id_token:'mocked-only-in-test'}),redirect:'manual'});expect(res.status).toBe(302);return{code:new URL(res.headers.get('location')!).searchParams.get('code')!,verifier};}
const token=(body:Record<string,string>)=>fetch(`${base}/oauth/token`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function authorize(){const c=await code();const r=await token({grant_type:'authorization_code',code:c.code,code_verifier:c.verifier,client_id:'test-client',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect'});expect(r.status).toBe(200);return r.json();}
describe('MCP OAuth continuity',()=>{
 it('renews a World-authorized session using a rotating refresh token',async()=>{const original=await authorize();const response=await token({grant_type:'refresh_token',refresh_token:original.refresh_token,client_id:'test-client'});expect(response.status).toBe(200);const refreshed=await response.json();expect(refreshed.access_token).not.toBe(original.access_token);expect(verifyMcpAccessToken(`Bearer ${refreshed.access_token}`)?.humanId).toBe('verified-test-human');expect((await token({grant_type:'refresh_token',refresh_token:original.refresh_token,client_id:'test-client'})).status).toBe(400);});
 it('rejects another client without destroying the rightful client refresh token',async()=>{const original=await authorize();expect((await token({grant_type:'refresh_token',refresh_token:original.refresh_token,client_id:'other-client'})).status).toBe(400);expect((await token({grant_type:'refresh_token',refresh_token:original.refresh_token,client_id:'test-client'})).status).toBe(200);});
 it('does not accept refresh credentials as MCP bearer access',async()=>{const original=await authorize();expect(verifyMcpAccessToken(`Bearer refresh:${original.refresh_token}`)).toBeNull();});
 it('binds authorization codes to their client',async()=>{const c=await code();const response=await token({grant_type:'authorization_code',code:c.code,code_verifier:c.verifier,client_id:'other-client',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect'});expect(response.status).toBe(400);});
});
