import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFxInput,parseMacroInput,createMiner} from '../src/miner.mjs';
import {createUnifiedHandler} from '../src/unified.mjs';
const now=()=>new Date('2026-10-26T12:00:00Z');
test('FX and conversion reject pair/orientation/amount contradictions, with equivalent decimal aliases accepted',()=>{
  for(const p of [{base:'EUR',quote:'INR',question:'USD to INR'},{base:'USD',quote:'INR',question:'USD per INR'},{base:'USD',quote:'INR',amount:'1',question:'Convert 100 USD to INR'},{base:'USD',quote:'INR',amount:'1',question:'Convert -1 USD to INR'}])assert.throws(()=>parseFxInput(p));
  assert.equal(parseFxInput({base:'USD',quote:'INR',amount:'1e2',question:'Convert 100.00 USD to INR'}).amount,'100');
  assert.equal(parseFxInput({base:'USD',quote:'INR',amount:'0',question:'Convert 0 USD to INR'}).amount,'0');
});
test('institutional rate, spreads and unsupported structured fields never become daily reference answers',()=>{
  for(const question of ['USD to INR institutional rate','USD to INR mid-market','USD to INR spread'])assert.throws(()=>parseFxInput({base:'USD',quote:'INR',question}),{code:'UNSUPPORTED_FREQUENCY'});
  for(const p of [{base:'USD',quote:'INR',requested_date:'2020-01-01'},{base:'USD',quote:'INR',frequency:'intraday'}])assert.throws(()=>parseFxInput(p),{code:'UNSUPPORTED_PARAMETER'});
  assert.throws(()=>parseFxInput({base:'USD',quote:'INR',date:''}),{code:'UNSUPPORTED_DATE'});
});
test('macro fields cannot override original country, indicator or exact year, including latest',()=>{
  for(const p of [{country:'US',indicator:'gdp',year:'2019',question:'India GDP 2019'},{country:'IN',indicator:'gdp',year:'2019',question:'India unemployment 2019'},{country:'IN',indicator:'gdp',year:'2020',question:'India GDP 2019'},{country:'IN',indicator:'gdp',year:'latest',question:'India GDP 2019'}])assert.throws(()=>parseMacroInput(p,now()),{code:'CONFLICTING_PARAMETER'});
  assert.deepEqual(parseMacroInput({country:'IND',indicator:'unemployment',year:2019,question:'India unemployment 2019'},now()),{country:'IND',indicator:'unemployment',year:'2019'});
});
test('original multi-task questions cannot be narrowed by structured hints',()=>{
  assert.throws(()=>parseFxInput({base:'USD',quote:'INR',question:'USD to INR and EUR to GBP'}),{code:'AMBIGUOUS_PAIR'});
  for(const p of [{country:'US',indicator:'gdp',year:2019,question:'US and India GDP 2019'},{country:'US',indicator:'gdp',year:2019,question:'US GDP and inflation 2019'},{country:'US',indicator:'gdp',year:2019,question:'US GDP 2019 and 2020'}])assert.throws(()=>parseMacroInput(p,now()));
  assert.throws(()=>parseMacroInput({country:'US',indicator:'gdp',frequency:'monthly'},now()),{code:'UNSUPPORTED_PARAMETER'});
});
test('HTTP context failures stop before source I/O and expose no score or substitute answer',async()=>{
  let calls=0;const numeric=createMiner({now,sources:{get:async()=>{calls++;throw Error('must not fetch');}}}),h=createUnifiedHandler({expanded:true,numeric});
  for(const [path,p] of [['/fx',{base:'EUR',quote:'USD',question:'USD to INR'}],['/convert',{base:'USD',quote:'INR',amount:1,question:'100 USD to INR'}],['/macro',{country:'US',indicator:'gdp',year:2020,question:'India GDP 2019'}]]){
    const r=await h(new Request('https://test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)})),a=await r.json();assert.equal(r.status,422);assert.equal(a.error.code,'CONFLICTING_PARAMETER');assert.equal(Object.hasOwn(a,'score_value'),false);assert.equal(a.verified_answer,false);
  }assert.equal(calls,0);
});
