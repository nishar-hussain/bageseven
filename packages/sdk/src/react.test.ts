import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BagsevenProvider, useBagseven, useConsumeEntitlement, useRemaining } from './react.js';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let context: ReturnType<typeof useBagseven>;
let consume: ReturnType<typeof useConsumeEntitlement>['consume'];
let total: string;
let renderer: ReactTestRenderer | undefined;
function Probe() { context=useBagseven(); total=useRemaining('ocr'); consume=useConsumeEntitlement().consume; return null; }
function ent(remaining='3',updated_at='2026-01-01T00:00:00.000Z') { return {feature:'ocr',remaining,allocation:'3',enabled:remaining!=='0',value:remaining!=='0',grant_id:'g',paid_through:'2099-01-01T00:00:00.000Z',updated_at}; }
const reply=(remaining='3',time?:string)=>new Response(JSON.stringify({entitlements:[ent(remaining,time)]}),{status:200});
async function mount(){await act(async()=>{renderer=create(createElement(BagsevenProvider,{publishableKey:'pk',accessToken:'token',holder:'customer',children:createElement(Probe)}));});}
afterEach(async()=>{if(renderer) await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('React SDK credit consistency',()=>{
 it('immediately keeps the consume result when a refresh returns an older balance',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>init?.method==='POST'?new Response(JSON.stringify({entitlement:ent('2','2026-01-02T00:00:00.000Z')})):reply()));
  await mount();await act(async()=>{await consume('ocr','1');});expect(context.entitlements[0].remaining).toBe('2');
 });
 it('ignores an earlier refresh that completes after the latest refresh',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply());vi.stubGlobal('fetch',fetch);await mount();
  let older!:(r:Response)=>void;let newer!:(r:Response)=>void;
  fetch.mockImplementationOnce(()=>new Promise<Response>(r=>{older=r;})).mockImplementationOnce(()=>new Promise<Response>(r=>{newer=r;}));
  let first!:Promise<void>;let second!:Promise<void>;
  await act(async()=>{first=context.refresh();second=context.refresh();newer(reply('1'));await second;});
  await act(async()=>{older(reply('3'));await first;});expect(context.entitlements[0].remaining).toBe('1');
 });
 it('keeps all grants and updates total available credits when the selected grant changes',async()=>{
  const first=ent('44'); const other={...ent('44'),grant_id:'other'};
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({entitlements:[first,other]})));vi.stubGlobal('fetch',fetch);await mount();
  expect(total).toBe('88');
  await act(async()=>{context.applyEntitlement({...ent('43','2026-01-02T00:00:00.000Z')});});
  expect(total).toBe('87');expect(context.entitlements).toHaveLength(2);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({entitlements:[first,other]})));
  await act(async()=>{await context.refresh();});expect(total).toBe('87');
 });
 it('reports refresh failure instead of silently presenting stale access as current',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply());vi.stubGlobal('fetch',fetch);await mount();fetch.mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async()=>{await expect(context.refresh()).rejects.toThrow('Network unavailable');});
  expect((context as unknown as {error:string}).error).toContain('Network unavailable');
 });
});
