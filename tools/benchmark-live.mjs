import { createMiner, ECB_URL } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { createServer } from '../src/server.mjs';
import { scaleForComparator } from '../src/evaluation.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), captures = new Map(), captureJobs=[];
const sources = createSources({fetchImpl:async(url,options)=>{const r=await fetch(url,options);const clone=r.clone();captureJobs.push(clone.text().then(text=>captures.set(url,{text,status:r.status,url})));return r;}});
const server = createServer({miner:createMiner({sources})});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`, fx=[],macro=[],warm=[];
const request=async(url)=>{const start=performance.now();try{const r=await fetch(url,{signal:AbortSignal.timeout(12000)});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body={raw:text.slice(0,150)}}return {status:r.status,duration_ms:performance.now()-start,response_sha256:createHash('sha256').update(text).digest('hex'),body};}catch(e){return {status:0,duration_ms:performance.now()-start,error:e.message}}};
try {
  // Alternate ordering to avoid always favoring a provider's first connection.
  for(let repeat=0;repeat<2;repeat++)for(const quote of ['EUR','INR','JPY']){
    let ours,other;const ownUrl=base+`/fx?base=USD&quote=${quote}`,otherUrl=`https://api.frankfurter.app/latest?from=USD&to=${quote}`;
    if(repeat===0){ours=await request(ownUrl);other=await request(otherUrl);}else{other=await request(otherUrl);ours=await request(ownUrl);}
    const sameDate=ours.status===200&&other.status===200&&ours.body.observation_date===other.body.date;
    fx.push({repeat,base:'USD',quote,ours,public_baseline:{url:otherUrl,...other},comparable_fixing_date:sameDate,rate_delta:sameDate?Number(ours.body.rate)-Number(other.body.rates[quote]):null,equal_at_pinned_scale_10000:sameDate?Math.round(Number(ours.body.rate)*10000)===Math.round(Number(other.body.rates[quote])*10000):null});
  }
  for(const [country,year]of [['US','2019'],['US','2010'],['DE','2019']])macro.push({country,year,result:await request(base+`/macro?country=${country}&indicator=unemployment&year=${year}`)});
  for(let i=0;i<30;i++)warm.push(await request(base+'/fx?base=USD&quote=INR'));
  await Promise.allSettled(captureJobs);
  const oracleInputs=[],ownValues=[];
  for(const row of fx.filter(r=>r.ours.status===200)){oracleInputs.push({kind:'fx',text:captures.get(ECB_URL).text,base:'USD',quote:row.quote});ownValues.push({value:row.ours.body.numeric_value,period:row.ours.body.observation_date});}
  for(const row of macro.filter(r=>r.result.status===200)){const b=row.result.body;oracleInputs.push({kind:'macro',text:captures.get(b.source.source_url).text,country:row.country,indicator:b.indicator_id,year:row.year});ownValues.push({value:b.numeric_value,period:String(b.observation_year)});}
  const oracle=spawnSync('python',['tools/live-reference-oracle.py'],{cwd:root,input:JSON.stringify(oracleInputs),encoding:'utf8',timeout:10000});if(oracle.error||oracle.status)throw new Error(oracle.error?.message??oracle.stderr);
  const expected=JSON.parse(oracle.stdout),checks=expected.map((e,i)=>({expected:e,actual:ownValues[i],pass:e.period===ownValues[i].period&&Number(e.value)===Number(ownValues[i].value)}));
  // Numeric strings are compared exactly after removing insignificant zeros;
  // Number is only retained above as a readable secondary check.
  const canon=s=>String(s).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1');
  checks.forEach(c=>c.pass=c.expected.period===c.actual.period&&canon(c.expected.value)===canon(c.actual.value));
  const {instance:{exports:w}}=await WebAssembly.instantiate(await readFile(resolve(root,'dist/referenceforge-comparator.wasm')));
  const pointer=w.imw_alloc(16),view=new DataView(w.memory.buffer);view.setBigInt64(pointer,2n,true);view.setBigInt64(pointer+8,50n,true);
  for(const row of fx.filter(r=>r.comparable_fixing_date)){
    const truth=scaleForComparator(row.ours.body.rate,'10000');
    row.score_against_ecb_capture={comparator_code:2,tolerance:50,scale:'10000',reference_construction:'Independent Python Decimal output verified equal to our rate; shared ECB source',ours_bps:Number(w.imw_score_deterministic(truth,scaleForComparator(row.ours.body.rate,'10000'),pointer)),baseline_bps:Number(w.imw_score_deterministic(truth,scaleForComparator(String(row.public_baseline.body.rates[row.quote]),'10000'),pointer))};
  }
  const timed=warm.filter(r=>r.status===200).map(r=>r.duration_ms).sort((a,b)=>a-b);
  const report={checked_at:new Date().toISOString(),predeclared_plan:'LIVE_BENCHMARK_PLAN.md',fx,macro,independent_implementation_checks:checks,warm_http:{requests:warm.length,successful:timed.length,latency_ms:timed.length?{p50:timed[Math.floor(timed.length*.5)],p95:timed[Math.ceil(timed.length*.95)-1],max:timed.at(-1)}:null},source_stats:sources.stats(),limitations:['Local HTTP vs remote API network paths; latency is not a fair deployed head-to-head','Both FX sources ultimately use ECB; World Bank references share upstream','Official V2 source default scale is not proof of deployed live database configuration','No hidden benchmark, paid routing, new-module admission or independent users'],status:'live_source_and_public_baseline_observation_not_network_ranking'};
  const stamp=report.checked_at.replaceAll(':','-'),directory=resolve(root,'research/benchmarks/live-'+stamp);await mkdir(directory,{recursive:true});
  const provenance=[];for(const [i,item]of [...captures.values()].entries()){await writeFile(resolve(directory,`source-${i}.txt`),item.text);provenance.push({url:item.url,status:item.status,file:`source-${i}.txt`,sha256:createHash('sha256').update(item.text).digest('hex')});}await writeFile(resolve(directory,'manifest.json'),JSON.stringify(provenance,null,2));
  await writeFile(resolve(root,'reports/live-benchmark.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(root,`reports/live-benchmark-${stamp}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checked_at:report.checked_at,fx_pairs:fx.length,unique_currency_pairs:3,comparable:fx.filter(r=>r.comparable_fixing_date).length,equal_at_scale:fx.filter(r=>r.equal_at_pinned_scale_10000).length,score_comparisons:fx.map(r=>({quote:r.quote,...r.score_against_ecb_capture})),macro_success:macro.filter(r=>r.result.status===200).length,oracle_checks:checks.length,oracle_matches:checks.filter(c=>c.pass).length,warm:report.warm_http,sources:report.source_stats},null,2));
  if(checks.some(c=>!c.pass)||fx.some(r=>r.ours.status!==200)||macro.some(r=>r.result.status!==200))process.exitCode=1;
}finally{await new Promise(r=>server.close(r));}
