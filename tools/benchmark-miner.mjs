import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMiner } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { createServer } from '../src/server.mjs';
import { checkAnswerContext } from '../src/evaluation.mjs';
const root = resolve(import.meta.dirname, '..');
let oldText = null, old = null, oldSources = null;
try { oldText = await readFile(resolve(root, 'research/build-baseline/miner-v0.1.mjs'), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (oldText !== null) {
const runnable = oldText.replaceAll("'./decimal.mjs'", JSON.stringify(pathToFileURL(resolve(root, 'src/decimal.mjs')).href)).replaceAll("'./errors.mjs'", JSON.stringify(pathToFileURL(resolve(root, 'src/errors.mjs')).href)).replaceAll("'./upstream.mjs'", JSON.stringify(pathToFileURL(resolve(root, 'research/build-baseline/upstream-v0.1.mjs')).href));
await writeFile(resolve(root, 'research/build-baseline/miner-runnable.mjs'), runnable);
await writeFile(resolve(root, 'research/build-baseline/errors.mjs'), await readFile(resolve(root, 'src/errors.mjs')));
old = await import(pathToFileURL(resolve(root, 'research/build-baseline/miner-runnable.mjs')).href);
({ createSources: oldSources } = await import(pathToFileURL(resolve(root, 'research/build-baseline/upstream-v0.1.mjs')).href));
}
const now = () => new Date('2026-10-23T12:00:00Z');
const xml = "<Envelope><Cube><Cube time='2026-10-23'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/><Cube currency='JPY' rate='200'/></Cube></Cube></Envelope>";
const wb = (indicator, rows) => JSON.stringify([{ pages: 1, lastupdated: '2026-10-08' }, rows.map(([year, value]) => ({ date: year, value, country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', indicator: { id: indicator } }))]);
const cases = [];
for (const [base, quote, rate] of [['EUR','USD','2.000000000000'],['USD','EUR','0.500000000000'],['USD','INR','50.000000000000'],['INR','USD','0.020000000000'],['JPY','INR','0.500000000000'],['USD','USD','1.000000000000']]) {
  for (const amount of ['0','1','20.25']) cases.push({ id: `fx-${base}-${quote}-${amount}`, family: 'fx_orientation_amount', endpoint: 'fx', params: { base, quote, amount }, expected: { rate, unit: `${quote} per ${base}`, observation_date: '2026-10-23' } });
}
for (const question of ['spot USD to INR','USD to INR 2020-01-01','USD to INR and EUR to JPY']) cases.push({ id: `scope-${cases.length}`, family: 'fx_scope', endpoint: 'fx', params: { question }, error: true });
for (const question of ['United States GDP per capita 2024','United States GDP PPP 2024','United States real GDP 2024','United States GDP constant dollars 2024','United States CPI index 2024','United States policy rate 2024']) cases.push({ id: `unit-${cases.length}`, family: 'unsupported_macro_unit', endpoint: 'macro', params: { question }, error: true });
for (const year of ['2019','2010']) cases.push({ id: `unemp-${year}`, family: 'unemployment_task_coverage', endpoint: 'macro', params: { country:'US', indicator:'unemployment', year }, payload: wb('SL.UEM.TOTL.ZS', [['2019','3.669'],['2010','9.633']]), expected: { value: year === '2019' ? '3.669':'9.633', observation_year:Number(year) } });
for (const [year,value] of [['2020','-2.5'],['2021','0'],['2022','5.125']]) cases.push({ id: `signed-${year}`, family: 'signed_and_zero_values', endpoint: 'macro', params:{country:'US',indicator:'gdp_growth',year},payload:wb('NY.GDP.MKTP.KD.ZG',[[year,value]]),expected:{value,observation_year:Number(year)} });
cases.push({ id:'missing-exact-year',family:'exact_period',endpoint:'macro',params:{country:'US',indicator:'gdp',year:'2023'},payload:wb('NY.GDP.MKTP.CD',[['2024','100']]),error:true });
cases.push({ id:'duplicate-observation',family:'ambiguous_upstream',endpoint:'macro',params:{country:'US',indicator:'gdp',year:'2024'},payload:wb('NY.GDP.MKTP.CD',[['2024','100'],['2024','101']]),error:true });
cases.push({ id:'latest-outside-window',family:'source_window',endpoint:'macro',params:{country:'US',indicator:'gdp',year:'latest'},payload:wb('NY.GDP.MKTP.CD',[['2010','100']]),error:true });
await mkdir(resolve(root,'reports'),{recursive:true});
await writeFile(resolve(root,'reports/miner-challenge-cases.json'),JSON.stringify({scope:'Authored development/regression corpus, not a held-out or competitor benchmark',cases},null,2));
async function correctness(factory) { const rows=[];for(const c of cases){const miner=factory({now,sources:{get:async()=>({text:c.endpoint==='fx'?xml:c.payload??wb('NY.GDP.MKTP.CD',[['2024','100']]),fetched_at:now().toISOString(),source_url:'https://synthetic-fixture.invalid',payload_sha256:'synthetic-not-live'})}});try{const answer=await miner[c.endpoint](c.params);let pass=!c.error;for(const [k,v]of Object.entries(c.expected??{}))pass&&=answer[k]===v;rows.push({id:c.id,family:c.family,pass,result:answer.numeric_value});}catch(e){rows.push({id:c.id,family:c.family,pass:!!c.error,error:e.code??e.message});}}return {total:rows.length,passed:rows.filter(r=>r.pass).length,rows};}
const stats = values => {const s=[...values].sort((a,b)=>a-b);return {p50:s[Math.floor(s.length*.5)],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
async function throughput() {let calls=0;const sources=createSources({now,fetchImpl:async()=>{calls++;return new Response(xml);}});const server=createServer({miner:createMiner({now,sources})});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;try{await fetch(base+'/fx?base=USD&quote=INR');const timings=[];let failures=0;for(let batch=0;batch<20;batch++)await Promise.all(Array.from({length:10},async()=>{const t=performance.now();const r=await fetch(base+'/fx?base=USD&quote=INR');const body=await r.json();timings.push(performance.now()-t);if(r.status!==200||body.rate!=='50.000000000000')failures++;}));return {requests:timings.length,concurrency:10,failures,latency_ms:stats(timings),upstream_calls_including_prime:calls,cache:sources.stats(),scope:'Loopback HTTP with synthetic source, not public latency or production capacity'};}finally{await new Promise(r=>server.close(r));}}
async function recovery(factory){let n=0;const sources=factory({retryDelayMs:0,fetchImpl:async()=>++n===1?new Response('transient',{status:503}):new Response(xml)});try{await sources.get('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',0);return {recovered:true,attempts:n};}catch(e){return {recovered:false,attempts:n,error:e.code};}}
// Metadata mutations leave the number unchanged. They illustrate exactly what
// a numeric-only comparator cannot detect, not a claim about competitors.
const ref={status:'ok',intent:'MACRO_ECONOMIC_INDICATOR',country:'US',indicator_id:'SL.UEM.TOTL.ZS',unit:'percent of total labor force',frequency:'annual',observation_year:2019,numeric_value:'3.669'};
const mutations=[{observation_year:2018},{country:'DE'},{unit:'fraction'},{indicator_id:'FP.CPI.TOTL.ZG'},{frequency:'monthly'}];
const context={valid_answer_accepted:checkAnswerContext(ref,ref).accepted,wrong_context_same_number:mutations.map(p=>({mutation:p,numeric_only_equal:true,context_result:checkAnswerContext(ref,{...ref,...p})}))};
const report={checked_at:new Date().toISOString(),method:'Authored development corpus and frozen fixtures. An optional local archive compares our own v0.1 on the same inputs; absent archives are reported as null. No independent generalization claim.',baseline_source_sha256:oldText===null?null:createHash('sha256').update(oldText).digest('hex'),baseline_v01:old?await correctness(old.createMiner):null,current:await correctness(createMiner),transient_503:{baseline_v01:oldSources?await recovery(oldSources):null,current:await recovery(createSources)},warm_http:await throughput(),context_guard:context,status:'local_development_measurement'};
await writeFile(resolve(root,'reports/miner-benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline_passed:report.baseline_v01?.passed??null,current_passed:report.current.passed,total:cases.length,recovery:report.transient_503,warm_http:report.warm_http,context_guard:context},null,2));
assert.equal(report.current.passed,cases.length);assert.equal(report.warm_http.failures,0);
if(report.baseline_v01)assert.equal(report.current.passed>report.baseline_v01.passed,true);
