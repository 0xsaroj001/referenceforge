import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {boundedText} from '../../src/onchain/rpc.mjs';

const ORIGIN='https://api.weather.gov';
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const sha=text=>createHash('sha256').update(text).digest('hex');
const stationId=v=>typeof v==='string'&&/^[A-Z0-9]{3,8}$/.test(v);

// This is an offline evaluation client, not a new public Provider capability.
export async function fetchObservationArchive({station,start,end,fetchImpl=fetch,onPage=async()=>{},maxPages=8,timeoutMs=20000}){
  assert(stationId(station),'Invalid station');assert(stamp(start)&&stamp(end)&&Date.parse(start)<Date.parse(end),'Invalid archive window');
  assert(Number.isInteger(maxPages)&&maxPages>0&&maxPages<=12,'Invalid page budget');
  const path='/stations/'+station+'/observations',startMs=Date.parse(start),endMs=Date.parse(end),seen=new Set(),records=new Map(),pages=[];
  const initial=new URL(path,ORIGIN);initial.search=new URLSearchParams({start,end,limit:'500'});
  let next=initial.href,previousOldest=Infinity,totalBytes=0;
  const signal=AbortSignal.timeout(timeoutMs);
  while(next){
    assert(pages.length<maxPages,'Observation archive page budget exceeded');
    const u=new URL(next);assert(u.origin===ORIGIN&&u.pathname===path&&!u.username&&!u.password&&!u.hash,'Untrusted archive pagination link');
    for(const [key,value] of u.searchParams){assert(['start','end','limit','cursor'].includes(key)&&u.searchParams.getAll(key).length===1,'Invalid pagination parameter');if(key==='start'||key==='end')assert(value===(key==='start'?start:end),'Pagination changed observation window');if(key==='limit')assert(/^[1-9]\d*$/.test(value)&&Number(value)<=500,'Invalid page size');if(key==='cursor')assert(value.length>0&&value.length<=2048,'Invalid cursor');}
    assert(!seen.has(u.href),'Observation archive pagination cycle');seen.add(u.href);
    const r=await fetchImpl(u.href,{redirect:'error',signal,headers:{'User-Agent':'ReferenceForge/evaluation (https://github.com/0xsaroj001/referenceforge)'}});
    assert(r.ok,'Observation archive HTTP '+r.status);
    const text=await boundedText(r,5000000,signal);totalBytes+=Buffer.byteLength(text);assert(totalBytes<=15000000,'Observation archive byte budget exceeded');
    const d=JSON.parse(text);assert(d.type==='FeatureCollection'&&Array.isArray(d.features)&&d.features.length<=500,'Invalid observation archive collection');
    const observations=d.features.map(f=>{const o=f?.properties;assert(f?.type==='Feature'&&o?.station===ORIGIN+'/stations/'+station&&stamp(o.timestamp),'Invalid observation station or timestamp');return o;});
    for(let i=1;i<observations.length;i++)assert(Date.parse(observations[i-1].timestamp)>=Date.parse(observations[i].timestamp),'Archive order is not newest first');
    const oldest=observations.length?Date.parse(observations.at(-1).timestamp):null;
    if(pages.length&&oldest!==null)assert(oldest<previousOldest,'Observation archive made no progress');
    for(const o of observations){const time=Date.parse(o.timestamp);if(time<startMs||time>endMs)continue;const key=new Date(time).toISOString(),old=records.get(key);assert(!old||JSON.stringify(old.temperature)===JSON.stringify(o.temperature),'Conflicting duplicate observation');records.set(key,o);}
    const page={url:u.href,sha256:sha(text),bytes:Buffer.byteLength(text),records:observations.length,oldest_at:oldest===null?null:new Date(oldest).toISOString()};pages.push(page);await onPage(page,text,pages.length);
    const link=d.pagination?.next;assert(link===undefined||link===null||typeof link==='string','Invalid pagination link');
    if(link){const linked=new URL(link);assert(linked.origin===ORIGIN&&linked.pathname===path&&!linked.username&&!linked.password&&!linked.hash,'Untrusted archive pagination link');}
    // NWS may emit a next cursor even after the requested start was reached.
    // Descending timestamps establish that later pages cannot add in-window data.
    if(oldest!==null&&oldest<=startMs)return {station,start,end,observations:[...records.values()],pages,complete:true,termination:'reached_window_start'};
    if(!link)return {station,start,end,observations:[...records.values()],pages,complete:true,termination:'source_exhausted'};
    assert(observations.length>0,'Empty observation page has a next link');previousOldest=oldest;next=link;
  }
}

export function observedTemperature(o){
  const q=o?.temperature;if(typeof q?.value!=='number'||!Number.isFinite(q.value)||!['C','S','V','G'].includes(q.qualityControl))return null;
  const value=q.unitCode==='wmoUnit:degC'?q.value:q.unitCode==='wmoUnit:degF'?(q.value-32)*5/9:null;
  return value!==null&&value>=-100&&value<=70?value:null;
}
export function validateForecastPlan(plan){
  assert(stamp(plan?.captured_at)&&Array.isArray(plan.cases)&&plan.cases.length>0&&plan.cases.length<=20,'Invalid frozen plan');
  const count=plan.cases.filter(c=>c.baseline!==undefined).length;assert(count===0||count===plan.cases.length,'Every location must have the same baseline design');
  for(const c of plan.cases){
    assert(stationId(c.station?.id)&&typeof c.city==='string'&&stamp(c.captured_at)&&stamp(c.forecast_issued_at),'Invalid frozen location metadata');
    assert(Number.isFinite(c.station.distance_km)&&c.station.distance_km>=0&&c.station.distance_km<=50,'Invalid observation distance');
    assert(Date.parse(c.forecast_issued_at)<=Date.parse(c.captured_at)&&Date.parse(c.captured_at)<=Date.parse(plan.captured_at),'Invalid frozen issue/capture order');
    assert(Array.isArray(c.hourly)&&c.hourly.length>0&&c.hourly.length<=48,'Invalid frozen hours');
    for(let i=0;i<c.hourly.length;i++){const h=c.hourly[i];assert(stamp(h.time)&&Date.parse(h.time)>Date.parse(plan.captured_at)&&typeof h.temperature_c==='number'&&Number.isFinite(h.temperature_c)&&h.temperature_c>=-100&&h.temperature_c<=70,'Capture must precede valid forecast targets');if(i)assert(Date.parse(h.time)-Date.parse(c.hourly[i-1].time)===3600000,'Forecast target hours must be contiguous');}
    if(c.baseline!==undefined){const b=c.baseline;assert(b?.kind==='persistence_temperature'&&b.station_id===c.station.id&&stamp(b.observed_at)&&Number.isFinite(b.temperature_c)&&b.temperature_c>=-100&&b.temperature_c<=70,'Invalid persistence baseline');const age=Date.parse(c.captured_at)-Date.parse(b.observed_at);assert(age>=0&&age<=5400000,'Baseline must be a fresh observation available before capture');}
  }
}
function metrics(pairs){return {paired_hours:pairs.length,mae_c:pairs.length?pairs.reduce((n,p)=>n+Math.abs(p.error_c),0)/pairs.length:null,rmse_c:pairs.length?Math.sqrt(pairs.reduce((n,p)=>n+p.error_c**2,0)/pairs.length):null,bias_c:pairs.length?pairs.reduce((n,p)=>n+p.error_c,0)/pairs.length:null};}
export function evaluateForecastPlan(plan,archives,{now=new Date()}={}){
  validateForecastPlan(plan);const last=Math.max(...plan.cases.flatMap(c=>c.hourly.map(h=>Date.parse(h.time))));assert(now.getTime()>=last+1800000,'Targets have not all matured');
  const pairs=[],missing=[];
  for(const c of plan.cases){const archive=archives.find(a=>a.station===c.station.id);assert(archive?.complete,'Incomplete station archive');
    const valid=archive.observations.filter(o=>o.station===ORIGIN+'/stations/'+c.station.id&&stamp(o.timestamp)).map(o=>({o,t:observedTemperature(o)})).filter(x=>x.t!==null);
    for(const h of c.hourly){const candidates=valid.map(x=>({...x,delta:Math.abs(Date.parse(x.o.timestamp)-Date.parse(h.time))})).filter(x=>x.delta<=1800000).sort((a,b)=>a.delta-b.delta||Date.parse(a.o.timestamp)-Date.parse(b.o.timestamp));const selected=candidates[0];
      if(!selected){missing.push({city:c.city,time:h.time,reason:'No accepted-quality temperature within 30 minutes'});continue;}
      pairs.push({city:c.city,time:h.time,observed_at:selected.o.timestamp,quality_control:selected.o.temperature.qualityControl,offset_seconds:selected.delta/1000,station_distance_km:c.station.distance_km,lead_hours:(Date.parse(h.time)-Date.parse(c.forecast_issued_at))/3600000,forecast_c:h.temperature_c,observed_c:selected.t,error_c:h.temperature_c-selected.t,...(c.baseline?{baseline_c:c.baseline.temperature_c,baseline_error_c:c.baseline.temperature_c-selected.t}:{})});
    }
  }
  const hasBaseline=plan.cases.every(c=>c.baseline!==undefined),baselineMetrics=p=>metrics(p.map(x=>({...x,error_c:x.baseline_error_c})));
  const per_location=plan.cases.map(c=>{const p=pairs.filter(p=>p.city===c.city);return {city:c.city,station:c.station.id,forecast_hours:c.hourly.length,missing_hours:missing.filter(m=>m.city===c.city).length,...metrics(p),...(hasBaseline?{persistence_baseline:baselineMetrics(p)}:{})};});
  const overall=metrics(pairs),baseline=hasBaseline?baselineMetrics(pairs):null;
  return {...overall,forecast_hours:pairs.length+missing.length,missing_hours:missing.length,coverage_fraction:pairs.length/(pairs.length+missing.length),per_location,pairs,missing,baseline_available:hasBaseline,skill_relative_to_baseline_measured:hasBaseline&&pairs.length>0,...(baseline?{persistence_baseline:baseline,mae_skill_vs_persistence:baseline.mae_c>0?1-overall.mae_c/baseline.mae_c:null}:{}),scope:'Prospective forecast-to-nearby-station temperature comparison. Not same-point truth, precipitation verification, a competitor comparison or a Telegraph score. '+(hasBaseline?'Frozen persistence baseline uses only the pre-target station observation, scored on identical valid pairs.':'No pre-target trivial baseline was frozen for this sample.')};
}
