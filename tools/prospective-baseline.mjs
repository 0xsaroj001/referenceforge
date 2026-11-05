// Freeze predictions and a trivial baseline before targets; never backfill them.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createWeather} from '../src/weather.mjs';
import {boundedText} from '../src/onchain/rpc.mjs';
import {fetchObservationArchive,evaluateForecastPlan,validateForecastPlan} from './lib/weather-evaluation.mjs';
const mode=process.argv[2]??'--status';assert(['--capture','--status','--evaluate'].includes(mode));
const dir='reports/weather/',pointer=dir+'prospective-baseline-latest.json',sha=text=>createHash('sha256').update(text).digest('hex');
await mkdir(dir,{recursive:true});
if(mode==='--capture'){
  const file='prospective-baseline-'+new Date().toISOString().slice(0,10)+'.json';
  let exists=false;try{await readFile(dir+file);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}assert(!exists,'A baseline sample is already frozen for today; use --status.');
  const captures=[],service=createWeather({fetchImpl:async(url,options)=>{const r=await fetch(url,options),text=await boundedText(r,1000000,options.signal);captures.push({url,status:r.status,sha256:sha(text),text});return new Response(text,{status:r.status,headers:r.headers});}}),cases=[];
  for(const city of [{name:'Miami',lat:25.7617,lon:-80.1918},{name:'New York',lat:40.7128,lon:-74.006},{name:'Kansas',lat:39.7456,lon:-97.0892}]){
    const p={lat:city.lat,lon:city.lon},forecast=await service.forecast({...p,hours:24}),current=await service.current(p),captured_at=new Date().toISOString();
    assert(['C','S','V','G'].includes(current.observation_quality.temperature),'Baseline requires a supplied accepted temperature QC flag');
    cases.push({city:city.name,station:current.station,forecast_issued_at:forecast.source_updated_at,captured_at,hourly:forecast.hourly.map(h=>({time:h.start_time,temperature_c:h.temperature_c})),baseline:{kind:'persistence_temperature',station_id:current.station.id,observed_at:current.observed_at,temperature_c:current.metrics.temperature},sources:[...forecast.sources,...current.sources]});
  }
  const plan={captured_at:new Date().toISOString(),transport:'local_original_runtime_direct_official_NWS',baseline_specification:'Hold the observed station temperature constant for every future target hour; compare to the forecast on identical valid observed pairs.',cases};validateForecastPlan(plan);
  const frozen={plan,sha256:sha(JSON.stringify(plan))};await writeFile(dir+file,JSON.stringify(frozen,null,2)+'\n',{flag:'wx',mode:0o600});await writeFile(dir+'baseline-captures-'+Date.now()+'.json',JSON.stringify(captures,null,2)+'\n');await writeFile(pointer,JSON.stringify({file},null,2)+'\n');
  console.log(JSON.stringify({state:'frozen',file,sha256:frozen.sha256,forecast_hours:cases.reduce((n,c)=>n+c.hourly.length,0),earliest_evaluation_at:new Date(Math.max(...cases.flatMap(c=>c.hourly.map(h=>Date.parse(h.time))))+1800000).toISOString(),skill_measured:false},null,2));
}else{
  const {file}=JSON.parse(await readFile(pointer,'utf8'));assert(/^prospective-baseline-\d{4}-\d{2}-\d{2}\.json$/.test(file));const {plan,sha256}=JSON.parse(await readFile(dir+file,'utf8'));assert.equal(sha(JSON.stringify(plan)),sha256,'Frozen sample hash changed');validateForecastPlan(plan);
  const earliest=Math.max(...plan.cases.flatMap(c=>c.hourly.map(h=>Date.parse(h.time))))+1800000;
  const resultFile=dir+'baseline-result-'+file;
  let saved;try{saved=JSON.parse(await readFile(resultFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(saved){
    assert.equal(saved.frozen_plan_sha256,sha256,'Saved evaluation belongs to a different frozen sample');
    assert(Number.isFinite(Date.parse(saved.checked_at))&&Date.parse(saved.checked_at)>=earliest,'Saved evaluation predates target maturity');
    assert.equal(saved.forecast_hours,plan.cases.reduce((n,c)=>n+c.hourly.length,0),'Saved evaluation target count changed');
    assert(Array.isArray(saved.pairs)&&Array.isArray(saved.missing)&&saved.pairs.length===saved.paired_hours&&saved.missing.length===saved.missing_hours&&saved.paired_hours+saved.missing_hours===saved.forecast_hours,'Invalid saved evaluation counts');
    console.log(JSON.stringify({state:'evaluated',file,sha256,result_file:resultFile,network_refresh:false,...saved,pairs:undefined,missing:undefined},null,2));
    process.exit(0);
  }
  if(mode==='--status'||Date.now()<earliest)console.log(JSON.stringify({state:Date.now()<earliest?'waiting_for_future_observations':'ready_to_evaluate',file,sha256,earliest_evaluation_at:new Date(earliest).toISOString(),forecast_hours:plan.cases.reduce((n,c)=>n+c.hourly.length,0),baseline_frozen:true,skill_measured:false},null,2));
  else{const archives=[];for(const c of plan.cases){const times=c.hourly.map(h=>Date.parse(h.time));archives.push(await fetchObservationArchive({station:c.station.id,start:new Date(Math.min(...times)-1800000).toISOString(),end:new Date(Math.max(...times)+1800000).toISOString(),onPage:async(_,text,index)=>writeFile(dir+'baseline-observations-'+file.slice(21,31)+'-'+c.station.id+'-'+index+'.json',text)}));}const r={checked_at:new Date().toISOString(),frozen_plan_sha256:sha256,...evaluateForecastPlan(plan,archives),archives:archives.map(({observations,...metadata})=>metadata)};await writeFile(resultFile,JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...r,pairs:undefined,missing:undefined},null,2));}
}
