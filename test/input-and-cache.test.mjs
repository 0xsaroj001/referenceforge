import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiner, parseFxInput, parseMacroInput } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { failureResponse } from '../src/responses.mjs';
import { ServiceError } from '../src/errors.mjs';
const now = () => new Date('2026-10-23T18:00:00Z');
const xml = "<Envelope><Cube time='2026-10-23'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/></Cube></Envelope>";

test('currency aliases normalize and conflicts never silently choose a default pair', () => {
  assert.deepEqual(parseFxInput({ from:' usd ', to:' inr ', amount:0 }),{base:'USD',quote:'INR',amount:'0'});
  assert.equal(parseFxInput({base:'USD',from:'usd',quote:'INR',to:'inr'}).quote,'INR');
  for(const p of [{base:'USD',from:'EUR',quote:'INR'},{base:'USD',quote:'INR',to:'JPY'},{query:'USD to INR',q:'EUR to USD'}])assert.throws(()=>parseFxInput(p),{code:'CONFLICTING_PARAMETER'});
  assert.throws(()=>parseFxInput({question:'convert money'}),{code:'AMBIGUOUS_PAIR'});
});

test('unsupported currencies never become a successful same-currency conversion', async () => {
  const miner=createMiner({now,sources:createSources({now,fetchImpl:async()=>new Response(xml)})});
  await assert.rejects(miner.fx({query:'USD to NGN'}),{code:'UNSUPPORTED_CURRENCY'});
  const same=await miner.fx({base:'USD',quote:'USD',amount:0});assert.equal(same.converted_amount,'0.000000000000');assert.equal(same.mode,'reference');assert.equal(same.fallback,false);
});

test('macro identifiers normalize while an exact day cannot silently become an annual observation', () => {
  assert.deepEqual(parseMacroInput({country:' us ',indicator:' Unemployment ',year:'2019'},now()),{country:'US',indicator:'unemployment',year:'2019'});
  assert.throws(()=>parseMacroInput({query:'US unemployment on 2019-01-01'},now()),{code:'UNSUPPORTED_FREQUENCY'});
  assert.throws(()=>parseMacroInput({country:'US',indicator:'gdp',question:'GDP 2020',query:'GDP 2021'},now()),{code:'CONFLICTING_PARAMETER'});
});

test('an invalid HTTP 200 feed is not cached and recovers on the next healthy response', async () => {
  let calls=0;const sources=createSources({now,fetchImpl:async()=>new Response(++calls===1?xml.replace("rate='2'","rate='1..2'"):xml)});
  const miner=createMiner({sources,now});
  await assert.rejects(miner.fx({base:'USD',quote:'INR'}),{code:'BAD_SOURCE',status:503});
  assert.equal(sources.stats().cached_entries,0);
  assert.equal((await miner.fx({base:'USD',quote:'INR'})).rate,'50.000000000000');
  assert.equal(calls,2);assert.equal(sources.stats().invalid_payloads,1);
});

test('a World Bank payload with invalid numeric content cannot poison its six-hour cache', async () => {
  let calls=0;const payload=value=>JSON.stringify([{pages:1,lastupdated:'2026-10-08'},[{date:'2019',country:{id:'US',value:'United States'},countryiso3code:'USA',indicator:{id:'SL.UEM.TOTL.ZS'},value}]]);
  const sources=createSources({now,fetchImpl:async()=>new Response(payload(++calls===1?'not-a-number':'3.669'))}),miner=createMiner({sources,now});
  await assert.rejects(miner.macro({country:'US',indicator:'unemployment',year:'2019'}),{code:'BAD_SOURCE',status:503});
  assert.equal(sources.stats().cached_entries,0);
  assert.equal((await miner.macro({country:'US',indicator:'unemployment',year:'2019'})).value,'3.669');assert.equal(calls,2);
});

test('caller validation also applies to cache hits and to coalesced reads', async () => {
  let calls=0;const sources=createSources({now,fetchImpl:async()=>new Response(++calls===1?'old':'fresh')});const url='https://www.ecb.europa.eu/example';
  await sources.get(url,1000);
  const value=await sources.get(url,1000,{validate:text=>{if(text!=='fresh')throw new ServiceError('BAD_SOURCE','old value',503);}});
  assert.equal(value.text,'fresh');assert.equal(calls,2);
  let release;const wait=new Promise(r=>release=r);const shared=createSources({fetchImpl:async()=>{await wait;return new Response('raw');}});
  const first=shared.get(url,1000), second=shared.get(url,1000,{validate:()=>{throw new ServiceError('BAD_SOURCE','rejected',503);}});
  release();await first;await assert.rejects(second,{code:'BAD_SOURCE'});assert.equal(shared.stats().cached_entries,0);
});

test('failure response modes distinguish unavailable upstreams from input refusals without success values', () => {
  assert.equal(failureResponse(new ServiceError('INVALID','Bad request')).body.mode,'refusal');
  const failed=failureResponse(new ServiceError('BAD_SOURCE','Bad upstream',503));assert.equal(failed.status,503);assert.equal(failed.body.mode,'unavailable');assert.equal(failed.body.fallback,false);assert.equal(failed.body.verified_answer,false);assert.equal(failed.body.numeric_value,undefined);
});
