import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnifiedWorker} from '../deploy/unified-worker.mjs';
test('Worker bounds overlapping requests across fresh handlers and restores capacity after completion',async()=>{
  const waiting=[];let created=0;
  const worker=createUnifiedWorker({maxConcurrent:2,handlerFactory:()=>{created++;return r=>new URL(r.url).pathname==='/health'?Response.json({status:'ok'}):new Promise(resolve=>waiting.push(resolve));}});
  const a=worker.fetch(new Request('https://test/tx')),b=worker.fetch(new Request('https://test/tx'));
  const blocked=await worker.fetch(new Request('https://test/tx'));assert.equal(blocked.status,503);assert.equal((await blocked.json()).error.code,'CAPACITY_LIMIT');assert.equal(created,2);
  assert.equal((await worker.fetch(new Request('https://test/health'))).status,200);
  waiting[0](Response.json({ok:true}));await a;
  const c=worker.fetch(new Request('https://test/tx'));assert.equal(waiting.length,3);waiting[1](Response.json({ok:true}));waiting[2](Response.json({ok:true}));await Promise.all([b,c]);
});
test('Worker releases capacity on a throwing handler without sharing its failed request state',async()=>{
  let calls=0;const w=createUnifiedWorker({maxConcurrent:1,handlerFactory:()=>async()=>{calls++;if(calls===1)throw Error('fail');return Response.json({ok:true});}});
  assert.equal((await w.fetch(new Request('https://test/tx'))).status,500);assert.equal((await w.fetch(new Request('https://test/tx'))).status,200);assert.equal(calls,2);
  for(const maxConcurrent of [0,-1,1.5,65])assert.throws(()=>createUnifiedWorker({maxConcurrent}));
});
