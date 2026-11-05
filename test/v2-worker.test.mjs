import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2Worker} from '../deploy/v2-worker.mjs';
import {v2Descriptor,v2ContractManifest} from '../tools/render-v2-miner.mjs';
import {V2_INTENTS,V2_PATHS} from '../src/v2.mjs';
import {readFile} from 'node:fs/promises';
const req=path=>new Request('https://test'+path);
test('Worker forwards V2 completion diagnostics and correlation headers',async()=>{
  const events=[],worker=createV2Worker({onDiagnostic:event=>events.push(event)});
  const response=await worker.fetch(req('/v2/tx?chain=base&tx_hash=invalid'));
  assert.equal(response.status,422);
  assert.equal(events.length,1);
  assert.equal(events[0].request_id,response.headers.get('x-referenceforge-request-id'));
  assert.equal(events[0].stage,'validation');
  assert.equal(events[0].error_code,'INVALID_HASH');
});
test('V2 Worker health separates concrete pairs from retained ten legacy families',async()=>{
  const worker=createV2Worker(),response=await worker.fetch(req('/health')),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.version,'0.6.0');assert.deepEqual(body.supported_intents,V2_INTENTS);assert.equal(body.legacy_capability_families.length,10);
  assert.equal(body.registration_status,'check_registry_and_node');assert.equal(body.registry_status_checked_by_health,false);assert.match(body.registration_lookup_url,/^https:\/\/devnode\.telegraphprotocol\.com\/miner-dispatcher\/miners\/address\/0x[a-f0-9]{40}\/yamls$/);assert(!Object.hasOwn(body,'v2_admission_verified'));
  assert.equal((await worker.fetch(req('/v2/wallet'))).status,422);
  assert.equal((await worker.fetch(req('/wallet-balance'))).status,422);
});
test('descriptor input/output names, versions and numeric units match captured official contracts',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../contracts/v2-intents.json',import.meta.url),'utf8')),d=v2Descriptor(),manifest=v2ContractManifest();
  assert.equal(snapshot.contracts.length,5);
  for(const c of snapshot.contracts){
    const m=d.intent_mapping[c.intent],row=manifest.contracts.find(x=>x.intent===c.intent);assert(m);
    assert.equal(row.request_schema_version,c.request.schema_version);assert.equal(row.response_format_version,c.response.format_version);
    assert.deepEqual(Object.keys(m.input).sort(),c.request.params.map(p=>p.name).sort());
    assert.deepEqual(Object.keys(m.output).sort(),c.response.fields.map(f=>f.name).sort());
    for(const f of c.response.fields.filter(f=>f.type==='number'))assert.equal(m.output[f.name].unit,f.unit);
  }
});
test('V2 asset allowlist preserves old routes and never exposes local files',async()=>{
  const seen=[],worker=createV2Worker(),env={ASSETS:{async fetch(r){seen.push(new URL(r.url).pathname);return new Response('public bytes');}}};
  for(const path of ['/referenceforge-v2.yaml','/v2-contract-manifest.json','/miner.yaml','/referenceforge-routing.yaml','/referenceforge-comparator.wasm']){
    const r=await worker.fetch(req(path),env);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await worker.fetch(new Request('https://test'+path,{method:'POST'}),env)).status,405);
  }
  for(const path of ['/reports/secret.json','/research/local-competitor-audit/README.md','/evaluator-v2/local/tx-evidence-cases.json'])assert.equal((await worker.fetch(req(path),env)).status,404);
  assert.equal(seen.length,5);assert.equal((await worker.fetch(req('/referenceforge-v2.yaml'))).status,503);
});
test('V2 and legacy requests share isolate admission and release capacity after failure',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  const worker=createV2Worker({maxConcurrent:1,servicesFactory:()=>({numeric:{async macro(){await blocked;throw new Error('private failure');}}})});
  const pending=worker.fetch(req('/v2/macro?indicator=unemployment%20rate&country=IN&year=2024'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await worker.fetch(req('/macro?country=IN&indicator=unemployment'))).status,503);
  assert.equal((await worker.fetch(req('/health'))).status,200);release();
  const failure=await pending;assert.equal(failure.status,500);assert(!JSON.stringify(await failure.json()).includes('private failure'));assert.equal((await worker.fetch(req('/wallet-balance'))).status,422);
});
test('V2 descriptor maps every canonical input and actual output path, without fallback signal guesses',()=>{
  const d=v2Descriptor();assert.equal(d.kind,'miner');assert.deepEqual(d.semantics.supported_intents,V2_INTENTS);assert.equal(d.endpoints.length,5);
  for(let i=0;i<5;i++){
    const m=d.intent_mapping[V2_INTENTS[i]],e=d.endpoints[i];assert.equal(m.endpoint,V2_PATHS[i]);assert.deepEqual(e.intents,[V2_INTENTS[i]]);
    assert.deepEqual(Object.keys(m.input),[...e.params.query.required,...e.params.query.optional].map(x=>x.name));
    for(const [name,value]of Object.entries(m.input))assert.equal(name,value.from);
    for(const [name,value]of Object.entries(m.output))assert.equal(name,value.path);
  }
  assert.equal(v2ContractManifest().admission_verified,false);assert.equal(Object.keys(v2ContractManifest().unmapped_families).length,5);
});
