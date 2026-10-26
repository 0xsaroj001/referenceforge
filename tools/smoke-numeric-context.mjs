import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const origin=process.argv[2]??'http://127.0.0.1:8794';
assert(['http://127.0.0.1:8794','https://referenceforge.0xsaroj001.workers.dev'].includes(origin));
const rows=[];
const cases=[
  ['fx-pair-conflict','/fx',{base:'EUR',quote:'INR',question:'USD to INR'},'CONFLICTING_PARAMETER'],
  ['fx-orientation-conflict','/fx',{base:'USD',quote:'INR',question:'USD per INR'},'CONFLICTING_PARAMETER'],
  ['conversion-amount-conflict','/convert',{base:'USD',quote:'INR',amount:'1',question:'100 USD to INR'},'CONFLICTING_PARAMETER'],
  ['fx-institutional','/fx',{base:'USD',quote:'INR',question:'USD to INR institutional rate'},'UNSUPPORTED_FREQUENCY'],
  ['fx-frequency','/fx',{base:'USD',quote:'INR',frequency:'intraday'},'UNSUPPORTED_PARAMETER'],
  ['macro-country-conflict','/macro',{country:'US',indicator:'gdp',year:'2019',question:'India GDP 2019'},'CONFLICTING_PARAMETER'],
  ['macro-indicator-conflict','/macro',{country:'IN',indicator:'gdp',year:'2019',question:'India unemployment 2019'},'CONFLICTING_PARAMETER'],
  ['macro-year-conflict','/macro',{country:'IN',indicator:'gdp',year:'2020',question:'India GDP 2019'},'CONFLICTING_PARAMETER'],
  ['macro-ambiguity','/macro',{country:'US',indicator:'gdp',year:'2019',question:'US and India GDP 2019'},'AMBIGUOUS_COUNTRY'],
  ['fx-reference','/fx',{base:'USD',quote:'INR',question:'USD to INR daily reference rate'},null],
  ['conversion-matching','/convert',{base:'USD',quote:'INR',amount:'100',question:'100 USD to INR'},null],
  ['macro-matching','/macro',{country:'IND',indicator:'gdp',year:'2019',question:'India GDP 2019'},null]
];
for(const [id,path,params,errorCode] of cases){
  const start=performance.now();let status,code;
  try{
    const r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(15000)}),a=await r.json();status=r.status;code=a.error?.code;
    assert.equal(status,errorCode?422:200);
    if(errorCode){assert.equal(code,errorCode);assert.equal(a.verified_answer,false);assert.equal(Object.hasOwn(a,'score_value'),false);}
    else{assert.equal(a.status,'ok');assert.equal(a.fallback,false);assert.equal(typeof a.score_value,'string');assert.match(a.source.payload_sha256,/^[a-f0-9]{64}$/);assert(Number.isFinite(Date.parse(a.source.fetched_at)));}
    rows.push({id,pass:true,status,code,latency_ms:Math.round(performance.now()-start)});
  }catch(e){rows.push({id,pass:false,status,code,error:e.message.slice(0,250)});}
}
const report={checked_at:new Date().toISOString(),origin,passed:rows.filter(x=>x.pass).length,total:rows.length,rows,scope:'Direct HTTP correctness and honest-refusal checks. Does not establish Telegraph routing, higher network scores or sustained uptime.'};
await mkdir('reports/network-quality',{recursive:true});
await writeFile('reports/network-quality/'+(origin.startsWith('http://127')?'workerd':'public')+'-numeric-context-'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
