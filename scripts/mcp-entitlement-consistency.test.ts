import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './bagseven-mcp';
const worker='00000000-0000-4000-8000-000000000001';
async function call(name:string,args:Record<string,unknown>,daemon:ReturnType<typeof vi.fn>){const s=buildServer(worker,daemon);const c=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();try{await s.connect(b);await c.connect(a);const r=await c.callTool({name,arguments:args});const content=r.content as {text:string}[];return {error:r.isError,data:r.isError?content[0].text:JSON.parse(content[0].text)};}finally{await c.close();await s.close();}}
describe('MCP entitlement selection',()=>{
 it('checks the same eligible unbound grants paid_run can actually use',async()=>{
  const daemon=vi.fn(async(_m:string,path:string)=>({grants:path.includes('worker_id=')?[]:[{id:'unbound',feature:'ocr',holder:'customer',remaining:'40',enabled:true},{id:'foreign',feature:'ocr',holder:'customer',remaining:'99',worker_id:'00000000-0000-4000-8000-000000000002'}]}));
  const r=await call('check_entitlement',{feature:'ocr',holder:'customer'},daemon);expect(r.error).not.toBe(true);expect(r.data.remaining).toBe('40');expect(r.data.enabled).toBe(true);
 });
 it('lists empty spending setup with a useful next step for entitlements-only connections',async()=>{
  const r=await call('list_mandates',{},vi.fn(async()=>{throw Error('NOT_FOUND: no agent found');}));expect(r.error).not.toBe(true);expect(r.data.mandates).toEqual([]);expect(r.data.requires_spending_permission).toBe(true);
 });
});
