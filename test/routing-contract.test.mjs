import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnifiedHandler} from '../src/unified.mjs';
import {createOnchainMiner} from '../src/onchain/verify.mjs';
import {METRIC_ROUTES} from '../src/onchain/routes.mjs';
import {routingDescriptor} from '../tools/render-routing-miner.mjs';
import {weatherDescriptor} from '../tools/render-weather-miner.mjs';
import {cases} from './fixtures/onchain-cases.mjs';
import {fixture,NOW} from './fixtures/onchain.mjs';
const request=(path,p)=>new Request('https://test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});
test('candidate keeps ten intents and makes each balance address or transaction hash mandatory',()=>{
  const d=routingDescriptor();assert.deepEqual(d.semantics.supported_intents,weatherDescriptor().semantics.supported_intents);assert.equal(d.id,1900999000);assert.equal(d.slug,'referenceforge-numeric');
  assert(!d.endpoints.some(e=>e.path==='/onchain-metric'));
  for(const [path,r] of Object.entries(METRIC_ROUTES)){const e=d.endpoints.find(e=>e.path===path);assert.deepEqual(e.intents,['ONCHAIN_METRIC_VERIFY']);assert.deepEqual(e.params.query.required.map(p=>p.name),r.required);assert(!e.params.query.optional.some(p=>p.name==='address'));}
});
test('score-history missing-address failure is reproducible, and explicit routes reject missing fields before RPC',async()=>{
  const f=fixture(),h=createUnifiedHandler({weather:true,onchain:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW})});
  const legacy=await h(request('/onchain-metric',{chain:'base',metric:'native_balance'}));assert.equal(legacy.status,422);assert.equal((await legacy.json()).error.code,'INVALID_ADDRESS');
  for(const [path,r] of Object.entries(METRIC_ROUTES)){const a=await h(request(path,{chain:'base'}));assert.equal(a.status,422);assert.equal((await a.json()).error.code,'MISSING_PARAMETER');}
  assert.equal(f.calls.length,0);
});
for(const c of cases.filter(c=>c.method==='metric'&&!c.error)){
  const path=Object.entries(METRIC_ROUTES).find(([,r])=>r.metric===c.params.metric)?.[0];if(!path)continue;
  test('explicit metric preserves requirement '+c.id,async()=>{
    const f=fixture(c.options),h=createUnifiedHandler({weather:true,onchain:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW})}),p={...c.params};delete p.metric;
    const r=await h(request(path,p)),a=await r.json();assert.equal(r.status,200);c.check(a,f);
  });
}
test('fixed route cannot be overridden by another metric or unrelated address/transaction fields',async()=>{
  let calls=0;const h=createUnifiedHandler({weather:true,onchain:{metric:async()=>{calls++;throw Error('must not call');}}});
  for(const p of [{chain:'base',metric:'native_balance',tx_hash:'0x'+'11'.repeat(32)},{chain:'base',address:'0x'+'11'.repeat(20)}]){const r=await h(request('/onchain-metric/gas',p));assert.equal(r.status,422);}
  assert.equal(calls,0);
});
test('failure telemetry contains field shapes but never values, queries or unexpected key names',async()=>{
  const secret='private-provider-value-do-not-log',logs=[],h=createUnifiedHandler({weather:true,onFailure:d=>logs.push(d),onchain:createOnchainMiner()});
  await h(request('/onchain-metric/native-balance',{chain:'base',address:secret}));
  await h(request('/onchain-metric/gas',{chain:'base',[secret]:secret}));
  const text=JSON.stringify(logs);assert(!text.includes(secret));assert(logs[0].parameter_shape.some(x=>x.name==='address'&&x.valid_hex_address===false));assert(logs[1].parameter_shape.some(x=>x.name==='unexpected'));
});
