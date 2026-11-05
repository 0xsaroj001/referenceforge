// A frozen prospective sample: never claim skill from successful HTTP/parsing.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fetchObservationArchive,evaluateForecastPlan,validateForecastPlan} from './lib/weather-evaluation.mjs';
const file='reports/weather/prospective-forecast.json',mode=process.argv[2]??'--status';
if(!['--capture','--status','--evaluate'].includes(mode))throw Error('Use --capture, --status or --evaluate.');
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
if(mode==='--capture'){
  const latest=JSON.parse(await readFile('reports/weather/latest-live.json','utf8')),r=JSON.parse(await readFile('reports/weather/'+latest.report,'utf8'));
  if(r.passed!==9)throw Error('Requires the complete three-location source sample.');
  const cases=r.rows.filter(x=>x.kind==='forecast').map(x=>{const o=r.rows.find(o=>o.city===x.city&&o.kind==='current').answer;return {city:x.city,station:o.station,forecast_issued_at:x.answer.source_updated_at,captured_at:r.checked_at,hourly:x.answer.hourly.map(h=>({time:h.start_time,temperature_c:h.temperature_c}))};});
  if(cases.some(x=>x.hourly.some(h=>Date.parse(h.time)<=Date.now())))throw Error('Prospective capture must precede every target time; rerun benchmark first.');
  const plan={captured_at:new Date().toISOString(),cases};await writeFile(file,JSON.stringify({plan,sha256:sha(plan)},null,2)+'\n',{flag:'wx',mode:0o600});console.log('Frozen prospective forecasts. Evaluate after the final target plus 30 minutes.');
}else{
  const {plan,sha256}=JSON.parse(await readFile(file,'utf8'));if(sha(plan)!==sha256)throw Error('Frozen forecast sample changed.');validateForecastPlan(plan);
  const final=Math.max(...plan.cases.flatMap(x=>x.hourly.map(h=>Date.parse(h.time))))+1800000;
  if(mode==='--status'||Date.now()<final){console.log(JSON.stringify({state:Date.now()<final?'waiting_for_future_observations':'ready_to_evaluate',earliest_evaluation_at:new Date(final).toISOString(),locations:plan.cases.length,forecast_hours:plan.cases.reduce((n,x)=>n+x.hourly.length,0),skill_measured:false}));}
  else{
    const archives=[];
    for(const c of plan.cases){
      const times=c.hourly.map(h=>Date.parse(h.time));
      archives.push(await fetchObservationArchive({station:c.station.id,start:new Date(Math.min(...times)-1800000).toISOString(),end:new Date(Math.max(...times)+1800000).toISOString(),onPage:async(_,text,index)=>writeFile('reports/weather/skill-observations-'+c.station.id+'-page-'+index+'.json',text)}));
    }
    const result={checked_at:new Date().toISOString(),frozen_plan_sha256:sha256,...evaluateForecastPlan(plan,archives),archives:archives.map(({observations,...metadata})=>metadata)};await writeFile('reports/weather/forecast-skill.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,pairs:undefined,missing:undefined},null,2));
  }
}
