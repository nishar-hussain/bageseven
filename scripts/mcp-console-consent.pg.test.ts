import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb, McpConsoleConsent } from '@bagseven/db';
import { randomUUID } from 'node:crypto';
const url=process.env.BILLING_TEST_DATABASE_URL;
describe.skipIf(!url)('console OAuth bridge (isolated PostgreSQL schema)',()=>{
 const schema='mcp_consent_'+randomUUID().replaceAll('-','');let admin:ReturnType<typeof createDb>,db:ReturnType<typeof createDb>,store:McpConsoleConsent;
 beforeAll(async()=>{admin=createDb({connectionString:url!});await admin.$client.query('create schema '+schema);const isolated=new URL(url!);isolated.searchParams.set('options','-csearch_path='+schema);db=createDb({connectionString:isolated.href});await db.$client.query('create table auth_credentials(key text primary key,data jsonb not null,expires_at timestamptz not null)');store=new McpConsoleConsent(db)});
 afterAll(async()=>{await db?.$client.end();if(admin){await admin.$client.query('drop schema '+schema+' cascade');await admin.$client.end()}});
 it('binds explicit consent to the initiating browser and issuer, with single-use proofs',async()=>{
  const started=await store.begin('https://mcp.example','client_id=client&state=original');const approved=await store.approve(started.id,'owner@example.com','0x'+'11'.repeat(20));
  expect(await store.finish(approved.code,'wrong-browser','https://mcp.example')).toBeUndefined();
  expect(await store.finish(approved.code,started.nonce,'https://other.example')).toBeUndefined();
  const proof=await store.finish(approved.code,started.nonce,'https://mcp.example');expect(proof).toMatchObject({email:'owner@example.com',query:'client_id=client&state=original'});
  expect(await store.finish(approved.code,started.nonce,'https://mcp.example')).toBeUndefined();
  await expect(store.approve(started.id,'attacker@example.com','0x'+'22'.repeat(20))).rejects.toThrow('CONSENT_EXPIRED');
 });
 it('expires requests and permits only one concurrent approval and one callback',async()=>{
  const expired=await store.begin('https://mcp.example','state=expired');await db.$client.query('update auth_credentials set expires_at=now()-interval \'1 second\'');await expect(store.approve(expired.id,'owner@example.com','wallet')).rejects.toThrow('CONSENT_EXPIRED');
  const started=await store.begin('https://mcp.example','state=current');const approved=await Promise.allSettled([store.approve(started.id,'owner@example.com','wallet'),store.approve(started.id,'owner@example.com','wallet')]);expect(approved.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const result=approved.find(result=>result.status==='fulfilled');if(result?.status!=='fulfilled')throw Error('missing approval');
  const callbacks=await Promise.all([store.finish(result.value.code,started.nonce,'https://mcp.example'),store.finish(result.value.code,started.nonce,'https://mcp.example')]);expect(callbacks.filter(Boolean)).toHaveLength(1);
 });
});
