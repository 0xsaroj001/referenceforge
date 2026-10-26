import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnchainHandler } from '../src/onchain/http.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { onchainDescriptor } from '../tools/render-onchain-miner.mjs';
import { cases,runCase } from './fixtures/onchain-cases.mjs';
import { fixture,TX,NOW } from './fixtures/onchain.mjs';
import { createOnchainServer } from '../src/onchain-server.mjs';
import { createOnchainWorker } from '../deploy/onchain-worker.mjs';
import { createRpcSession } from '../src/onchain/rpc.mjs';

for(const c of cases)test('onchain requirement: '+c.id,()=>runCase(c));
test('onchain RPC diagnostics omit URLs, request parameters and upstream error text',async()=>{
  const f=fixture({transport:({rows})=>new Response(JSON.stringify(rows.map(x=>({...x,error:{code:-32000,message:'private upstream detail'}}))))});
  const errors=[],rpc=createRpcSession(f.network,{fetchImpl:f.fetchImpl,onRpcError:e=>errors.push(e)});
  await assert.rejects(rpc.both([{method:'eth_chainId'}]),{code:'RPC_UNAVAILABLE'});
  assert.equal(errors.length,2);assert.equal(errors[0].rpc_code,-32000);
  assert(!JSON.stringify(errors).includes('private upstream detail'));assert(!JSON.stringify(errors).includes('https://'));
});
test('onchain RPC retries a short rate limit once and accounts for both attempts',async()=>{
  let failed=false;
  const f=fixture({transport:({index,rows})=>{if(index===1&&!failed){failed=true;return new Response('limited',{status:429,headers:{'retry-after':'0.01'}});}return new Response(JSON.stringify(rows));}});
  const rpc=createRpcSession(f.network,{fetchImpl:f.fetchImpl});
  const result=await rpc.both([{method:'eth_chainId'}]);assert.equal(result[0][0],result[1][0]);
  assert.equal(rpc.stats().http_requests,3);assert.equal(rpc.stats().rate_limit_retries,1);assert.equal(rpc.evidence[1].batches[0].attempts,2);
});
test('onchain RPC honors a long Retry-After by refusing rather than retrying early',async()=>{
  const f=fixture({transport:()=>new Response('limited',{status:429,headers:{'retry-after':'60'}})}),rpc=createRpcSession(f.network,{fetchImpl:f.fetchImpl});
  await assert.rejects(rpc.both([{method:'eth_chainId'}]),{code:'RPC_UNAVAILABLE'});
  assert.equal(rpc.stats().http_requests,2);assert.equal(rpc.stats().rate_limit_retries,0);
});
test('RPC respects each operator batch size and preserves result order and total cost',async()=>{
  const f=fixture(),rpc=createRpcSession(f.network,{fetchImpl:f.fetchImpl});
  const calls=[{method:'eth_chainId'},{method:'eth_chainId'},{method:'eth_chainId'},{method:'eth_chainId'}];
  const values=await rpc.both(calls);assert.deepEqual(values[0],values[1]);assert.equal(values[0].length,4);
  assert(f.calls.filter(x=>x.operator===0).every(x=>x.methods.length<=3));assert.equal(f.calls.filter(x=>x.operator===0).length,2);
  assert.equal(rpc.stats().http_requests,3);assert.equal(rpc.stats().rpc_methods,8);
});
test('onchain HTTP rejects ambiguous and unsupported requests before calling the miner',async()=>{
  let called=0;const handle=createOnchainHandler({miner:{transfer:async()=>{called++;return {};}}});
  for(const request of [new Request('http://local/verify-transfer?chain=base&chain=base-sepolia'),new Request('http://local/verify-transfer?chain=base',{method:'POST',headers:{'content-type':'application/json'},body:'{"chain":"base-sepolia"}'}),new Request('http://local/verify-transfer',{method:'POST',headers:{'content-type':'application/json'},body:'[]'}),new Request('http://local/verify-transfer',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(16385)})])assert.equal((await handle(request)).status,400);
  assert.equal(called,0);
});
test('onchain HTTP and schema expose both intents without changing the numeric descriptor',async()=>{
  const f=fixture(),handle=createOnchainHandler({miner:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW})});
  const r=await handle(new Request(`http://local/verify-transfer?chain=base-sepolia&asset=native&tx_hash=${TX}`));
  assert.equal(r.status,200);assert.equal((await r.json()).claim_verified,true);
  const health=await(await handle(new Request('http://local/health'))).json();
  assert.deepEqual(health.supported_intents,['CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY']);
  const d=onchainDescriptor({id:12345,baseUrl:'http://localhost:8790'});
  assert.deepEqual(d.semantics.supported_intents,health.supported_intents);assert.equal(d.cache_ttl_sec,0);assert.equal(d.endpoints[0].params.query.required.length,3);
});
test('onchain HTTP enforces its local concurrent-work bound',async()=>{
  let release;const handle=createOnchainHandler({maxConcurrent:1,miner:{transfer:()=>new Promise(r=>{release=r;})}});
  const first=handle(new Request('http://local/verify-transfer'));
  await new Promise(r=>setImmediate(r));
  const second=await handle(new Request('http://local/verify-transfer'));assert.equal(second.status,503);assert.equal((await second.json()).error.code,'CAPACITY_LIMIT');
  release({status:'ok'});assert.equal((await first).status,200);
});
test('onchain Worker serves only the explicit descriptor asset and preserves its exact bytes',async()=>{
  const bytes='{"version":"1"}\n';let assets=0;
  const worker=createOnchainWorker({handlerFactory:()=>async()=>new Response('not found',{status:404})});
  const env={ONCHAIN_ASSETS:{fetch:async()=>{assets++;return new Response(bytes);}}};
  const r=await worker.fetch(new Request('https://local/miner.yaml'),env);
  assert.equal(r.status,200);assert.equal(await r.text(),bytes);assert.match(r.headers.get('content-type'),/yaml/);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal((await worker.fetch(new Request('https://local/miner.yaml',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(new Request('https://local/reports/private.json'),env)).status,404);
  assert.equal(assets,1);
  assert.equal((await worker.fetch(new Request('https://local/miner.yaml'))).status,503);
});
test('onchain Node adapter supports POST and bounded-body errors over real loopback HTTP',async()=>{
  const f=fixture(),server=createOnchainServer({miner:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const r=await fetch(origin+'/verify-transfer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chain:'base-sepolia',asset:'native',tx_hash:TX})});
    assert.equal(r.status,200);assert.equal((await r.json()).claim_verified,true);
    const bad=await fetch(origin+'/verify-transfer',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(16385)});
    assert.equal(bad.status,400);assert.equal((await bad.json()).verified_answer,false);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
