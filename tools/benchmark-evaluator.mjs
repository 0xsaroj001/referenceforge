import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { scoreStructuredAnswer, scaleForComparator } from '../src/evaluation.mjs';
const root=resolve(import.meta.dirname,'..');
const live=JSON.parse(await readFile(resolve(root,'reports/live-benchmark.json'),'utf8'));
const bytes=await readFile(resolve(root,'dist/referenceforge-comparator.wasm'));
const {instance:{exports:w}}=await WebAssembly.instantiate(bytes);
const cases=[];
for(let i=0;i<live.macro.length;i++){
  const c=live.macro[i],check=live.independent_implementation_checks[6+i];
  if(c.result.status!==200||!check?.pass)throw new Error('Successful independent source transformation evidence required');
  const reference={status:'ok',intent:'MACRO_ECONOMIC_INDICATOR',country:c.country,indicator_id:'SL.UEM.TOTL.ZS',unit:'percent of total labor force',frequency:'annual',observation_year:Number(c.year),numeric_value:check.expected.value};
  const provenance={source_url:c.result.body.source.source_url,payload_sha256:c.result.body.source.payload_sha256,reference_method:'Python Decimal transformation of captured World Bank response; no independent upstream or human review claimed'};
  cases.push({id:`${c.country}-${c.year}-valid`,reference,answer:{...reference},expected_good:true,provenance});
  for(const [name,mutation]of Object.entries({wrong_year:{observation_year:Number(c.year)-1},wrong_country:{country:c.country==='US'?'DE':'US'},wrong_indicator:{indicator_id:'FP.CPI.TOTL.ZG'},wrong_unit:{unit:'fraction'},wrong_frequency:{frequency:'monthly'},missing_period:{observation_year:undefined},wrong_number:{numeric_value:'100'},not_numeric:{numeric_value:'unavailable'}}))cases.push({id:`${c.country}-${c.year}-${name}`,reference,answer:{...reference,...mutation},expected_good:false,provenance});
}
const results=[];
for(const c of cases){let baseline;
  try {const p=w.imw_alloc(16),v=new DataView(w.memory.buffer);v.setBigInt64(p,2n,true);v.setBigInt64(p+8,150n,true);const score=w.imw_score_deterministic(scaleForComparator(c.reference.numeric_value,'1000'),scaleForComparator(c.answer.numeric_value,'1000'),p);w.imw_free(p,16);baseline={accepted:score>=0n,score_bps:Number(score)};}
  catch {baseline={accepted:false,score_bps:null};}
  const current=scoreStructuredAnswer(c.reference,c.answer,{comparator:w,scale:'1000',code:2,tolerance:150});
  results.push({id:c.id,expected_good:c.expected_good,baseline_numeric_only:baseline,current,baseline_calls_good:baseline.accepted&&baseline.score_bps>=5000,current_calls_good:current.accepted&&current.score_bps>=5000});
}
const metric=key=>({false_accepts:results.filter(r=>!r.expected_good&&r[key]).length,false_rejects:results.filter(r=>r.expected_good&&!r[key]).length,valid_cases:results.filter(r=>r.expected_good).length,invalid_cases:results.filter(r=>!r.expected_good).length});
const report={checked_at:new Date().toISOString(),artifact_sha256:createHash('sha256').update(bytes).digest('hex'),corpus_scope:'27 authored development cases around 3 captured source observations; mutations are synthetic, not a hidden or independently reviewed assessment',baseline:'Same comparator and fixed-point inputs, without structured-context validation. This is an ablation, not a competing registered evaluator.',baseline_numeric_only:metric('baseline_calls_good'),context_plus_wasm:metric('current_calls_good'),results,limitations:['Context checks occur outside WASM and are not a change to the Telegraph ABI','Self-reported metadata can be forged; this does not verify arbitrary prose or authenticate a response','No evaluation-pool admission or live node parser integration has been tested']};
await writeFile(resolve(root,'reports/evaluator-challenge-cases.json'),JSON.stringify({status:'local_development_material_not_an_evaluation_pool_upload',cases},null,2)+'\n');
await writeFile(resolve(root,'reports/evaluator-benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,baseline:report.baseline_numeric_only,current:report.context_plus_wasm},null,2));
if(report.context_plus_wasm.false_accepts||report.context_plus_wasm.false_rejects)process.exitCode=1;
