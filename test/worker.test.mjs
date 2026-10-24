import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../deploy/worker.mjs';
import { checkAnswerContext, scaleForComparator } from '../src/evaluation.mjs';

test('Worker HTTP contract preserves errors, parameters and explicit asset boundaries', async () => {
  const app=createWorker({miner:{fx:async p=>({status:'ok',numeric_value:'2',params:p})}});
  const response=await app.fetch(new Request('https://example.com/fx?base=EUR&quote=USD'));assert.equal(response.status,200);assert.equal((await response.json()).params.base,'EUR');
  const post=await app.fetch(new Request('https://example.com/fx',{method:'POST',headers:{'content-type':'application/json'},body:'{"base":"EUR","quote":"USD"}'}));assert.equal(post.status,200);
  const big=await app.fetch(new Request('https://example.com/fx',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(65537)}));assert.equal(big.status,413);
  assert.equal((await app.fetch(new Request('https://example.com/research/STRATEGY.md'))).status,404);
  assert.equal((await app.fetch(new Request('https://example.com/miner.yaml'))).status,503);
});

test('context validation checks metadata separately from exact fixed-point scaling', () => {
  const ref={intent:'FX_NOW',base:'USD',quote:'INR',unit:'INR per USD',frequency:'daily_reference',observation_date:'2026-10-23'};
  const answer={...ref,status:'ok',numeric_value:'94.945054945055'};assert.equal(checkAnswerContext(ref,answer).accepted,true);
  assert.equal(checkAnswerContext(ref,{...answer,observation_date:'2026-10-22'}).reason,'observation_date_mismatch');
  assert.equal(scaleForComparator('94.945054945055','10000'),949451n);assert.equal(scaleForComparator('-1.2345','1000'),-1235n);
  assert.throws(()=>scaleForComparator('1e30','10000'),/overflow/);
});
