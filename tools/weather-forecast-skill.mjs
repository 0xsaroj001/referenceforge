// A frozen prospective sample: never claim skill from successful HTTP/parsing.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {boundedText} from '../src/onchain/rpc.mjs';
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
  const {plan,sha256}=JSON.parse(await readFile(file,'utf8'));if(sha(plan)!==sha256)throw Error('Frozen forecast sample changed.');
  const final=Math.max(...plan.cases.flatMap(x=>x.hourly.map(h=>Date.parse(h.time))))+1800000;
  if(mode==='--status'||Date.now()<final){console.log(JSON.stringify({state:Date.now()<final?'waiting_for_future_observations':'ready_to_evaluate',earliest_evaluation_at:new Date(final).toISOString(),locations:plan.cases.length,forecast_hours:plan.cases.reduce((n,x)=>n+x.hourly.length,0),skill_measured:false}));}
  else{
    const pairs=[],missing=[];
    for(const c of plan.cases){
      if(!/^[A-Z0-9]{3,8}$/.test(c.station.id))throw Error('Unrecognized station.');
      const times=c.hourly.map(h=>Date.parse(h.time)),query=new URLSearchParams({start:new Date(Math.min(...times)-1800000).toISOString(),end:new Date(Math.max(...times)+1800000).toISOString(),limit:'500'});
      const r=await fetch('https://api.weather.gov/stations/'+c.station.id+'/observations?'+query,{headers:{'User-Agent':'ReferenceForge/0.5 (https://github.com/0xsaroj001/referenceforge)'},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Observation archive unavailable.');const text=await boundedText(r,5000000);const d=JSON.parse(text);if(!Array.isArray(d.features)||d.pagination?.next)throw Error('Incomplete observation archive.');
      await writeFile('reports/weather/skill-observations-'+c.station.id+'.json',text);
      const observations=d.features.map(f=>f.properties).filter(o=>o?.station?.endsWith('/'+c.station.id)&&Number.isFinite(Date.parse(o.timestamp))&&typeof o.temperature?.value==='number'&&!['Z','X','Q'].includes(o.temperature.qualityControl)&&['wmoUnit:degC','wmoUnit:degF'].includes(o.temperature.unitCode));
      for(const h of c.hourly){const o=observations.map(o=>({o,delta:Math.abs(Date.parse(o.timestamp)-Date.parse(h.time))})).filter(x=>x.delta<=1800000).sort((a,b)=>a.delta-b.delta)[0];if(!o){missing.push({city:c.city,time:h.time});continue;}const t=o.o.temperature.unitCode==='wmoUnit:degF'?(o.o.temperature.value-32)*5/9:o.o.temperature.value;pairs.push({city:c.city,time:h.time,observed_at:o.o.timestamp,station_distance_km:c.station.distance_km,forecast_c:h.temperature_c,observed_c:t,error_c:h.temperature_c-t});}
    }
    const result={checked_at:new Date().toISOString(),frozen_plan_sha256:sha256,paired_hours:pairs.length,missing_hours:missing.length,mae_c:pairs.length?pairs.reduce((n,p)=>n+Math.abs(p.error_c),0)/pairs.length:null,rmse_c:pairs.length?Math.sqrt(pairs.reduce((n,p)=>n+p.error_c**2,0)/pairs.length):null,pairs,missing,scope:'Prospective forecast-to-nearby-station temperature comparison, not same-point truth, precipitation verification, a competitor comparison, or a Telegraph quality score.'};await writeFile('reports/weather/forecast-skill.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,pairs:undefined,missing:undefined},null,2));
  }
}
