#!/usr/bin/env node
// Isolated integration test: Anvil on :58545 with chain ID 1874 and a migrated
// PostgreSQL database whose name contains _test. Never reads the live .env.
// BAGSEVEN_CHECKOUT_TEST_DATABASE_URL=postgres://.../bagseven_checkout_test pnpm test:checkout
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';
import solc from'solc';import Fastify from'../services/daemon/node_modules/fastify/fastify.js';
import{createPublicClient,createWalletClient,http,parseAbi}from'viem';import{privateKeyToAccount}from'viem/accounts';
import{createDb}from'@bagseven/db';import{MandateClient,whitechainSepolia,workerKey}from'@bagseven/onchain';
import{errorResponse}from'@bagseven/server';import{getGrantStore}from'@bagseven/entitlements';
import{registerBillingRoutes}from'../services/daemon/dist/billing.js';
import{registerPublicEntitlementRoutes}from'../services/daemon/dist/public-entitlements.js';
import{registerGrantRoutes}from'../services/daemon/dist/grants.js';
import{PostgresBillingStore}from'../services/daemon/dist/billing-store.js';
import{paymentAuthorizationMessage}from'../services/daemon/dist/whitechain-payment.js';
import{buildPolicyRoutes}from'../services/policy/dist/routes.js';
const worker=randomUUID(),child=randomUUID(),rpc='http://127.0.0.1:58545';
const testDatabase = process.env.BAGSEVEN_CHECKOUT_TEST_DATABASE_URL;
assert.ok(testDatabase, 'Set BAGSEVEN_CHECKOUT_TEST_DATABASE_URL to an isolated local test database');
const databaseUrl = new URL(testDatabase);
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname) && databaseUrl.pathname.includes('_test'), 'Requires a local database with _test in its name');
const localKey='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
Object.assign(process.env,{NODE_ENV:'test',WORLD_MOCK_PROOFS:'false',WHITECHAIN_DEMO_SETTLE:'false',WORLD_CLIENT_ID:'',WORLD_RP_SIGNING_KEY:'',ENTITLEMENT_STORE:'memory',ARKIV_ACCESS_KEY:'',ARKIV_PRIVATE_KEY:'',CHAIN_ID:'1874',WHITECHAIN_CHAIN_ID:'1874',WHITECHAIN_NETWORK:'testnet',WHITECHAIN_RPC_URL:rpc,RPC_URL:rpc,DAEMON_AUTH_TOKEN:'sk_integration',BAGSEVEN_SECRET_KEY:'sk_integration',BAGSEVEN_PUBLISHABLE_KEY:'pk_integration',BAGSEVEN_MCP_WORKER:worker,NOTIFY_MODE:'log',RESEND_API_KEY:'',OPERATOR_NOTIFY_EMAIL:''});
const publicClient=createPublicClient({chain:whitechainSepolia,transport:http(rpc)});
assert.equal(await publicClient.getChainId(),1874);assert.match(await publicClient.request({method:'web3_clientVersion'}),/anvil/i);
const buyer=privateKeyToAccount(localKey),merchant='0x1111111111111111111111111111111111111111';
const wallet=createWalletClient({account:buyer,chain:whitechainSepolia,transport:http(rpc)});
const src=readFileSync('scripts/contracts/LocalUSDC.sol','utf8');
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Token.sol':{content:src}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
const compiled=output.contracts['Token.sol'].LocalUSDC;
const wait=async hash=>{const receipt=await publicClient.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return receipt};
const token=(await wait(await wallet.deployContract({abi:compiled.abi,bytecode:`0x${compiled.evm.bytecode.object}`}))).contractAddress;
process.env.WHITECHAIN_USDT=token;
await wait(await wallet.writeContract({address:token,abi:parseAbi(['function mint(address,uint256)']),functionName:'mint',args:[buyer.address,100_000_000n]}));
const mandate=new MandateClient(localKey,{rpcUrl:rpc,chainId:1874});
const contract=await mandate.deploy({owner:buyer.address,operator:buyer.address,enforcer:buyer.address,usdc:token,budgetPerWindow:10_000_000n,windowSeconds:86400,lifetimeCap:100_000_000n,perPurchaseCap:10_000_000n,perSellerPct:10000,maxDepth:1,rootWorker:workerKey(worker),rootAllocation:100_000_000n});
await mandate.fund(contract,token,10_000_000n);
const db=createDb({connectionString:testDatabase});
const app=Fastify();app.setErrorHandler((error,_req,reply)=>{const e=errorResponse(error);return reply.code(e.status).send(e.body)});
const deps={resolveMandateCapacity:async(id,amount)=>({ok:await mandate.checkWorker(contract,BigInt(Math.round(Number(amount)*1e6)),'0x0000000000000000000000000000000000000000',workerKey(id))===0})};
registerBillingRoutes(app,{db});registerPublicEntitlementRoutes(app,deps);registerGrantRoutes(app,deps);
await app.ready();const evidence=[];
async function request(path,body,status=200,key='sk_integration'){const r=await app.inject({method:body?'POST':'GET',url:path,headers:{authorization:`Bearer ${key}`},payload:body});assert.equal(r.statusCode,status,`${path}: ${r.body}`);return r.json()}
try{
 const plan=(await request('/v1/plans',{feature:'ocr',name:'Verified checkout',amount:'5.00',credits:'3',ttl_seconds:600,merchant_wallet:merchant})).plan;
 const session=(await request('/v1/checkout-sessions',{plan_id:plan.id,holder:'verified-buyer'})).session;
 const pgStore=new PostgresBillingStore(db);assert.equal((await pgStore.getPlan(plan.id)).name,plan.name);assert.equal((await pgStore.getCheckout(session.id)).status,'PENDING');evidence.push('Plans and checkout survive a fresh PostgreSQL store instance');
 const hash=await wallet.writeContract({address:token,abi:parseAbi(['function transfer(address,uint256) returns(bool)']),functionName:'transfer',args:[merchant,5_000_000n]});await wait(hash);await publicClient.request({method:'evm_mine',params:[]});
 const signature=await buyer.signMessage({message:paymentAuthorizationMessage(`checkout:${session.id}`,hash,1874)});
 const payload={payment_tx:hash,customer_wallet:buyer.address,payment_signature:signature};
 const paid=await request(`/v1/public/checkout/${session.id}/confirm`,payload);assert.equal(paid.verification,'verified');assert.equal(paid.grant.remaining,'3');assert.equal(paid.session.status,'PAID');evidence.push('Actual local token transfer + payer signature + exact receipt minted one living grant');
 const repeated=await request(`/v1/public/checkout/${session.id}/confirm`,payload);assert.equal(repeated.already_paid,true);assert.equal((await getGrantStore().findLive({holder:'verified-buyer'})).length,1);evidence.push('Duplicate confirmation returned the existing checkout, without a second grant');
 const other=(await request('/v1/checkout-sessions',{plan_id:plan.id,holder:'different-buyer'})).session;
 const otherSignature=await buyer.signMessage({message:paymentAuthorizationMessage(`checkout:${other.id}`,hash,1874)});
 await request(`/v1/public/checkout/${other.id}/confirm`,{...payload,payment_signature:otherSignature},409);evidence.push('A second checkout could not redeem the same real transaction');
 const check=await request('/v1/check?feature=ocr&holder=verified-buyer',undefined,200,'pk_integration');assert.equal(check.enabled,true);evidence.push('SDK public check sees the paid entitlement');
 const run=await request('/internal/grants/paid-run',{grant_id:paid.grant.id,amount:'1'});assert.equal(run.grant.remaining,'2');evidence.push('Paid run used the bound worker and actual on-chain mandate capacity');
 await mandate.registerWorker(contract,workerKey(child),workerKey(worker),buyer.address,500_000n,1);
 await request('/internal/grants/paid-run',{grant_id:paid.grant.id,amount:'1',worker_id:child},403);evidence.push('A child with insufficient allocation was refused');
 await mandate.revoke(contract);await request('/internal/grants/paid-run',{grant_id:paid.grant.id,amount:'1'},403);assert.equal((await getGrantStore().get(paid.grant.id)).remaining,'2');evidence.push('On-chain revocation refused paid work and preserved credits');
 assert.equal((await new PostgresBillingStore(db).getCheckout(session.id)).status,'PAID');
 const persisted=await new PostgresBillingStore(db).getCheckout(session.id);assert.equal(persisted.platform_fee_bps,10);assert.equal(persisted.platform_fee_amount,'0.005');assert.equal(persisted.amount,'5.00');assert.equal(await publicClient.readContract({address:token,abi:parseAbi(['function balanceOf(address) view returns(uint256)']),functionName:'balanceOf',args:[merchant]}),5_000_000n);evidence.push('Provider received the full payment; one exact 0.1% fee persisted after retries and store restart');
 const policy=Fastify();policy.setErrorHandler((error,_req,reply)=>{const e=errorResponse(error);return reply.code(e.status).send(e.body)});
 buildPolicyRoutes(policy,{db,redis:{},config:{CHAIN_ID:'1874'}});
 const wrongChain=await policy.inject({method:'POST',url:'/v1/mandates',payload:{owner_address:buyer.address,operator_address:buyer.address,budget_per_window:'10',window_seconds:86400,lifetime_cap:'100',per_purchase_cap:'1',per_seller_pct:10000,max_depth:1,chain_id:1,signature:'0x01'}});
 assert.equal(wrongChain.statusCode,400);assert.equal(wrongChain.json().error.code,'CHAIN_MISMATCH');await policy.close();evidence.push('Mandate signatures for another chain were rejected before deployment');

 if(process.env.BAGSEVEN_CHECKOUT_REPORT) writeFileSync(process.env.BAGSEVEN_CHECKOUT_REPORT,JSON.stringify({scope:'Isolated Anvil 1874 and PostgreSQL; real local receipts and cryptographic wallet signatures, no World proof fabricated, no external funds',result:'PASS',checks:evidence,local_payment:hash},null,2));
 console.log(JSON.stringify({result:'PASS',checks:evidence,local_payment:hash},null,2));
}finally{await app.close();await db.$client.end()}
