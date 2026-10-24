import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMiner } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
let oldText = null, oldMiner = null, oldSources = null;
try { oldText = await readFile(new URL('../research/build-baseline/v0.2/miner.mjs', import.meta.url)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (oldText !== null) {
  ({ createMiner: oldMiner } = await import('../research/build-baseline/v0.2/miner.mjs'));
  ({ createSources: oldSources } = await import('../research/build-baseline/v0.2/upstream.mjs'));
}

const now=()=>new Date('2026-10-23T18:00:00Z');
const xml="<Envelope><Cube time='2026-10-23'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/></Cube></Envelope>";
const wb=value=>JSON.stringify([{pages:1,lastupdated:'2026-10-08'},[{date:'2019',value,country:{id:'US',value:'United States'},countryiso3code:'USA',indicator:{id:'SL.UEM.TOTL.ZS'}}]]);
const cases=[
  {id:'from-to-aliases',endpoint:'fx',params:{from:'USD',to:'INR'},value:'50.000000000000'},
  {id:'trim-currency-codes',endpoint:'fx',params:{base:' usd ',quote:' inr '},value:'50.000000000000'},
  {id:'conflicting-base-alias',endpoint:'fx',params:{base:'USD',from:'EUR',quote:'INR'},error:'CONFLICTING_PARAMETER'},
  {id:'conflicting-quote-alias',endpoint:'fx',params:{base:'USD',quote:'INR',to:'EUR'},error:'CONFLICTING_PARAMETER'},
  {id:'conflicting-question-alias',endpoint:'fx',params:{query:'USD to INR',q:'EUR to USD'},error:'CONFLICTING_PARAMETER'},
  {id:'unsupported-currency-never-defaults',endpoint:'fx',params:{query:'USD to NGN'},error:'UNSUPPORTED_CURRENCY'},
  {id:'zero-amount-is-preserved',endpoint:'fx',params:{base:'USD',quote:'INR',amount:0},converted:'0.000000000000'},
  {id:'missing-pair-refused',endpoint:'fx',params:{question:'Convert this amount'},error:'AMBIGUOUS_PAIR'},
  {id:'normalized-macro-identifiers',endpoint:'macro',params:{country:' us ',indicator:' Unemployment ',year:'2019'},value:'3.669'},
  {id:'specific-day-not-an-annual-answer',endpoint:'macro',params:{question:'US unemployment on 2019-01-01'},error:'UNSUPPORTED_FREQUENCY'}
];
async function run(factory,sourceFactory){
  const results=[];
  for(const c of cases){const sources=sourceFactory({now,fetchImpl:async()=>new Response(c.endpoint==='fx'?xml:wb('3.669'))});const miner=factory({now,sources});try{const a=await miner[c.endpoint](c.params);results.push({id:c.id,pass:!c.error&&(c.value===undefined||a.numeric_value===c.value)&&(c.converted===undefined||a.converted_amount===c.converted),value:a.numeric_value});}catch(e){results.push({id:c.id,pass:e.code===c.error,error:e.code});}}
  for(const [id,endpoint,bad,good,params]of [
    ['invalid-fx-payload-recovery','fx',xml.replace("rate='2'","rate='1..2'"),xml,{base:'USD',quote:'INR'}],
    ['invalid-macro-value-recovery','macro',wb('not-a-number'),wb('3.669'),{country:'US',indicator:'unemployment',year:'2019'}],
    ['missing-observation-recovery','macro',wb(null),wb('3.669'),{country:'US',indicator:'unemployment',year:'2019'}]
  ]){let calls=0;const sources=sourceFactory({now,fetchImpl:async()=>new Response(++calls===1?bad:good)}),miner=factory({sources,now});let firstRefused=false,secondRecovered=false;try{await miner[endpoint](params)}catch{firstRefused=true;}try{const a=await miner[endpoint](params);secondRecovered=a.numeric_value===(endpoint==='fx'?'50.000000000000':'3.669');}catch{}results.push({id,pass:firstRefused&&secondRecovered,first_refused:firstRefused,second_recovered:secondRecovered,upstream_reads:calls});}
  let moment=new Date('2026-10-30T00:00:00Z'),calls=0;const clock=()=>moment;
  const sources=sourceFactory({now:clock,fetchImpl:async()=>new Response(++calls===1?xml:xml.replace('2026-10-23','2026-10-30'))}),miner=factory({now:clock,sources});
  await miner.fx({base:'USD',quote:'INR'});moment=new Date('2026-10-30T00:00:01Z');let recovered=false;
  try{recovered=(await miner.fx({base:'USD',quote:'INR'})).observation_date==='2026-10-30';}catch{}
  results.push({id:'expired-observation-refreshed-within-cache-ttl',pass:recovered,upstream_reads:calls});
  return {passed:results.filter(r=>r.pass).length,total:results.length,results};
}
const report={checked_at:new Date().toISOString(),scope:'Authored regression cases and injected source faults. Optional baseline is our own archived v0.2; absent archives are reported as null.',baseline_source_sha256:oldText===null?null:createHash('sha256').update(oldText).digest('hex'),baseline_v02:oldMiner?await run(oldMiner,oldSources):null,current:await run(createMiner,createSources)};
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/input-cache-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline:report.baseline_v02?.passed??null,current:report.current.passed,total:report.current.total,recovery:report.current.results.slice(10)},null,2));
if(report.current.passed!==report.current.total)process.exitCode=1;
