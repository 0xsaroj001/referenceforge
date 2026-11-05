import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseIntegerJson,scoreComparatorBatch,createComparatorExecutor,COMPARATOR_SHA256} from '../src/comparator-runnable.mjs';
const bytes=await readFile('deploy/v2-public/referenceforge-comparator.wasm').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(bytes)assert.equal(createHash('sha256').update(bytes).digest('hex'),COMPARATOR_SHA256);
const module=bytes?await WebAssembly.compile(bytes):null,executor=module?createComparatorExecutor(module):null;
const artifactTest=(name,fn)=>test(name,{skip:module?false:'Prepare the pinned public artifact with node tools/prepare-v2-deployment.mjs'},fn);
const q=(truth,miner,kind=0,tolerance=0)=>`{"ground_truth_value":${truth},"miner_value":${miner},"spec":[${kind},${tolerance}]}`;
const send=body=>executor.fetch(new Request('https://local.test/run',{method:'POST',headers:{'content-type':'application/json'},body}));
artifactTest('int64 adjacent values survive raw JSON and score differently',async()=>{
  const r=await send(`{"batch":[${q('1000000000000000000','1000000000000000000')},${q('1000000000000000000','1000000000000000001')}]}`);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{results:[{score:10000},{score:0}]});
});
artifactTest('batch preserves order, signed input, relative tolerance and explicit refusals',()=>{
  const body=parseIntegerJson(`{"batch":[${q(-100,-105,1,10)},${q('1000000000000000000','1005000000000000000',2,100)},${q(0,0)},${q('9223372036854775808',1)},${q(1,1,4294967297,10)}]}`);
  assert.deepEqual(scoreComparatorBatch(module,body),{results:[{score:7500},{score:7500},{error:'COMPARATOR_REFUSED'},{error:'INVALID_COMPARATOR_INPUT'},{score:10000}]});
});
test('ambiguous and malformed JSON cannot overwrite numeric inputs',()=>{
  for(const raw of ['{"batch":[],"ba\\u0074ch":[]}','{"a":{"x":1,"x":2}}','{"x":1.0}','{"x":1e3}','{"x":01}','{"x":1} trailing','[[[[[[[[[[0]]]]]]]]]]'])assert.throws(()=>parseIntegerJson(raw));
  assert.equal(parseIntegerJson('{"a":{"x":1},"b":{"x":2}}').b.x,2n);
});
artifactTest('malformed envelopes and quoted int64s refuse without fake scores',async()=>{
  for(const body of ['{}','{"batch":[]}',JSON.stringify({batch:Array(101).fill({})})])assert.equal((await send(body)).status,400);
  const r=await send('{"batch":[{"ground_truth_value":"1","miner_value":1,"spec":[0,0]}]}');assert.deepEqual(await r.json(),{results:[{error:'INVALID_COMPARATOR_INPUT'}]});
});
artifactTest('bounds apply to streamed bodies and UTF8, not just Content-Length',async()=>{
  assert.equal((await send(' '.repeat(1048577))).status,413);
  const r=await executor.fetch(new Request('https://local.test/run',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([0xff])}));assert.equal(r.status,400);
  assert.equal((await send(' '.repeat(1048500)+'{"batch":['+q(1,1)+']}')).status,200);
});
artifactTest('method/path/content restrictions and immutable artifact health identity',async()=>{
  for(const [path,method,status]of [['/run','GET',405],['/private','GET',404]])assert.equal((await executor.fetch(new Request('https://local.test'+path,{method}))).status,status);
  assert.equal((await executor.fetch(new Request('https://local.test/run',{method:'POST',body:'{}'}))).status,415);
  assert.equal((await (await executor.fetch(new Request('https://local.test/health'))).json()).artifact_sha256,COMPARATOR_SHA256);
});
artifactTest('repeated and concurrent requests reproduce the same compiled module scores',async()=>{
  const body=`{"batch":[${q(100,105,1,10)},${q(-100,-120,1,10)}]}`;
  const results=await Promise.all(Array.from({length:10},async()=>await (await send(body)).json()));for(const result of results)assert.deepEqual(result,{results:[{score:7500},{score:0}]});
});
artifactTest('stalled input reaches its deadline even when cancellation never settles',async()=>{
  let cancelled=0;const request=new Request('https://local.test/run',{method:'POST',headers:{'content-type':'application/json'},duplex:'half',body:new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}})});
  const start=Date.now(),r=await executor.fetch(request);assert.equal(r.status,408);assert.equal(cancelled,1);assert(Date.now()-start<12000);assert.equal(request.body.locked,false);
});
