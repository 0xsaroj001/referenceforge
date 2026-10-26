import test from 'node:test';
import assert from 'node:assert/strict';
import {createSources} from '../src/upstream.mjs';
import {createMiner,ECB_URL} from '../src/miner.mjs';
const fixed=Date.parse('2026-10-26T12:00:00Z'),xml="<Envelope><Cube time='2026-10-26'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/></Cube></Envelope>";
function fixture(){const entries=new Map();return {entries,cacheApi:{match:async r=>entries.get(r.url)?.clone(),put:async(r,response)=>{entries.set(r.url,response.clone());}}};}
test('new request-owned clients reuse validated persistent bytes, preserving original time and hash',async()=>{
  const f=fixture();let calls=0,clock=fixed;const options={now:()=>new Date(clock),cacheApi:f.cacheApi,fetchImpl:async()=>{calls++;return new Response(xml);}};
  const first=await createMiner({now:options.now,sources:createSources(options)}).fx({base:'USD',quote:'INR'});clock+=1000;
  const sources=createSources(options),second=await createMiner({now:options.now,sources}).fx({base:'USD',quote:'INR'});
  assert.equal(calls,1);assert.equal(first.source.fetched_at,second.source.fetched_at);assert.equal(first.source.payload_sha256,second.source.payload_sha256);assert.equal(second.source.cache_hit,true);assert.equal(sources.stats().persistent_cache_hits,1);
});
test('persistent cache expiry cannot be extended by a new client or a changed TTL',async()=>{
  const f=fixture();let clock=fixed,calls=0;const options={now:()=>new Date(clock),cacheApi:f.cacheApi,fetchImpl:async()=>{calls++;return new Response('source');}};
  await createSources(options).get(ECB_URL,2000);clock+=2001;await createSources(options).get(ECB_URL,2000);assert.equal(calls,2);
  clock+=1;await createSources(options).get(ECB_URL,500);assert.equal(calls,3);
});
test('persistent bytes, identity, future timestamps and semantic data are independently revalidated',async()=>{
  for(const corrupt of [e=>e.value.text+='tampered',e=>e.value.source_url='https://api.worldbank.org/wrong',e=>e.value.fetched_at='2099-01-01T00:00:00Z',e=>e.expires+=3600000]){
    const f=fixture();let calls=0;const options={now:()=>new Date(fixed),cacheApi:f.cacheApi,fetchImpl:async()=>{calls++;return new Response(xml);}};
    await createSources(options).get(ECB_URL,300000);const [key,r]=[...f.entries][0],entry=await r.json();corrupt(entry);f.entries.set(key,Response.json(entry));
    await createMiner({now:options.now,sources:createSources(options)}).fx({base:'USD',quote:'INR'});assert.equal(calls,2);
  }
  const f=fixture();let calls=0;const opts={now:()=>new Date(fixed),cacheApi:f.cacheApi,fetchImpl:async()=>new Response(++calls===1?'invalid':xml)};
  await createSources(opts).get(ECB_URL,300000);await createMiner({now:opts.now,sources:createSources(opts)}).fx({base:'USD',quote:'INR'});assert.equal(calls,2);
});
test('cache failures never prevent valid source reads; no-store and max-age govern both caches',async()=>{
  const broken={match:async()=>{throw Error('cache unavailable');},put:async()=>{throw Error('cache unavailable');}};
  const s=createSources({cacheApi:broken,fetchImpl:async()=>new Response('valid')});assert.equal((await s.get(ECB_URL,1000)).text,'valid');
  let calls=0;const f=fixture(),sources=createSources({cacheApi:f.cacheApi,fetchImpl:async()=>{calls++;return new Response('uncached',{headers:{'cache-control':'no-store'}});}});
  await sources.get(ECB_URL,1000);await sources.get(ECB_URL,1000);assert.equal(calls,2);assert.equal(f.entries.size,0);
  let clock=fixed,loads=0;const opts={now:()=>new Date(clock),cacheApi:f.cacheApi,fetchImpl:async()=>{loads++;return new Response('source',{headers:{'cache-control':'max-age=5',age:'3'}});}};
  await createSources(opts).get(ECB_URL,10000);clock+=2100;await createSources(opts).get(ECB_URL,10000);assert.equal(loads,2);
});
