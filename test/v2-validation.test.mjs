import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {checkCanonicalAnswer,checkDescriptorContracts,checkPlatformValidation,postPlatformValidation} from '../tools/lib/v2-validation.mjs';
import {v2Descriptor} from '../tools/render-v2-miner.mjs';
const contracts=JSON.parse(await readFile(new URL('../contracts/v2-intents.json',import.meta.url),'utf8')).contracts,d=v2Descriptor();
const response=()=>({valid:true,slug:d.slug,name:d.name,results:d.endpoints.map(e=>({path:e.path,method:e.method,status:200,success:true}))});
test('platform validation requires all fulfilled endpoint results and matching identity, not a green reachability flag',()=>{
  assert(checkPlatformValidation(200,response(),d));
  for(const mutate of [r=>r.valid=false,r=>r.slug='other',r=>r.errors=['bad schema'],r=>r.conflicts=['collision'],r=>r.results.pop(),r=>r.results[0].status=422,r=>r.results[0].success=false,r=>r.results[1].path=r.results[0].path]){const r=response();mutate(r);assert.throws(()=>checkPlatformValidation(200,r,d));}
  assert.throws(()=>checkPlatformValidation(401,response(),d));
});
test('independent contract check refuses wrong mapping, missing inputs and guessed units',()=>{
  assert.equal(checkDescriptorContracts(d,contracts).contracts,5);
  for(const mutate of [x=>delete x.intent_mapping.WALLET_BALANCE_CHECK_GENERAL.input.chain,x=>x.intent_mapping.WALLET_BALANCE_CHECK_GENERAL.output.balance.unit='wei',x=>x.intent_mapping.ONCHAIN_TX_LOOKUP_GENERAL.output.block_number.path='value_eth',x=>x.endpoints[0].params.query.required.pop()]){const m=structuredClone(d);mutate(m);assert.throws(()=>checkDescriptorContracts(m,contracts));}
});
test('canonical answers reject raw numeric strings, missing source, out-of-range values and provider-created field_status',()=>{
  const c=contracts.find(x=>x.intent==='WEATHER_CHECK_TEMPERATURE'),answer={provider_status:'ok',intent:c.intent,request_schema_version:3,response_format_version:1,temperature_c:20,evidence:{status:'ok',verified_answer:true,fallback:false,sources:[{},{}]}};
  assert.equal(checkCanonicalAnswer(answer,c).fields[0],'temperature_c');
  for(const mutate of [x=>x.temperature_c='20',x=>x.temperature_c=NaN,x=>x.temperature_c=70,x=>delete x.temperature_c,x=>x.evidence.verified_answer=false,x=>x.field_status={temperature_c:'ok'}]){const b=structuredClone(answer);mutate(b);assert.throws(()=>checkCanonicalAnswer(b,c));}
});
test('source conformance respects distinct macro/RPC evidence contracts rather than inventing uniform flags',()=>{
  const c=contracts.find(x=>x.intent==='MACRO_ECONOMIC_INDICATOR_GENERAL'),answer={provider_status:'ok',intent:c.intent,request_schema_version:1,response_format_version:1,rate_pct:4.2,evidence:{status:'ok',fallback:false,indicator_id:'SL.UEM.TOTL.ZS',source:{source_url:'https://api.worldbank.org/v2/country/IN',payload_sha256:'ab'.repeat(32)}}};
  assert(checkCanonicalAnswer(answer,c));delete answer.evidence.source;assert.throws(()=>checkCanonicalAnswer(answer,c));
});
test('validation POST sends descriptor only and never accepts header injection or leaks authorization into body',async()=>{
  let observed;const result=await postPlatformValidation('{"version":"1"}',{authorization:'Bearer local-session',fetchImpl:async(url,init)=>{observed={url,init};return Response.json({message:'Unauthorized'},{status:401});}});
  assert.equal(result.status,401);assert.equal(observed.url,'https://anjoman.ai/api/registrations/validate');assert.deepEqual(JSON.parse(observed.init.body),{yaml:'{"version":"1"}'});assert.equal(observed.init.redirect,'error');
  await assert.rejects(postPlatformValidation('{}',{authorization:'Bearer bad\r\nX: unsafe'}));
});
