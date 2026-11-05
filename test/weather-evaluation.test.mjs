import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchObservationArchive,evaluateForecastPlan,observedTemperature,validateForecastPlan} from '../tools/lib/weather-evaluation.mjs';
const origin='https://api.weather.gov',station='KAAA',path=origin+'/stations/'+station+'/observations',start='2026-10-26T00:00:00.000Z',end='2026-10-26T03:00:00.000Z';
const obs=(time,value=20,qualityControl='V',unitCode='wmoUnit:degC')=>({type:'Feature',properties:{station:origin+'/stations/'+station,timestamp:time,temperature:{value,unitCode,qualityControl}}});
const page=(features,next)=>({type:'FeatureCollection',features,...(next?{pagination:{next}}:{})});
function fixture(pages,options={}){const calls=[];return {calls,run:()=>fetchObservationArchive({station,start,end,fetchImpl:async(url,o)=>{calls.push({url,redirect:o.redirect});return new Response(JSON.stringify(pages[calls.length-1]));},...options})};}
test('archive follows same-station cursor, de-duplicates boundaries and stops before out-of-window pages',async()=>{
 const f=fixture([page([obs(end),obs('2026-10-26T02:00:00Z')],path+'?cursor=page2'),page([obs('2026-10-26T02:00:00Z'),obs(start)],path+'?cursor=unneeded')]);const a=await f.run();assert.equal(f.calls.length,2);assert.equal(a.observations.length,3);assert.equal(a.termination,'reached_window_start');assert(a.pages.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)));assert(f.calls.every(c=>c.redirect==='error'));
});
test('NWS terminal cursor at the requested start does not make a complete response fail',async()=>{const f=fixture([page([obs(end),obs(start)],path+'?cursor=older')]);assert.equal((await f.run()).complete,true);assert.equal(f.calls.length,1);});
test('foreign hosts, credentials, other stations, fragments and changed query bounds cannot be followed',async()=>{
 for(const link of ['https://evil.test/x','https://user:password@api.weather.gov/stations/KAAA/observations?cursor=x',origin+'/stations/KBBB/observations?cursor=x',path+'?cursor=x#frag',path+'?start=wrong&cursor=x',path+'?cursor=a&cursor=b',path+'?source_url=https://evil.test']){const f=fixture([page([obs(end)],link)]);await assert.rejects(f.run());assert.equal(f.calls.length,1);}
});
test('cycles, nonprogress, order changes, station mismatch, duplicates and exhausted budgets fail closed',async()=>{
 const next=path+'?cursor=x';for(const pages of [[page([obs(end)],next),page([obs(end)],next)],[page([obs(start),obs(end)])],[page([obs(end)],next),page([obs('2026-10-26T02:00:00Z')],path+'?cursor=y')],[page([{...obs(end),properties:{...obs(end).properties,station:origin+'/stations/KBBB'}}])],[page([obs(end),obs(end,99)])]]){const f=fixture(pages,{maxPages:1});await assert.rejects(f.run());}
 const f=fixture([page([obs(end)],next),page([obs(end)],next)]);await assert.rejects(f.run(),/progress|cycle/);
});
test('archive refuses HTTP errors, malformed bodies and empty pages with pagination',async()=>{
 await assert.rejects(fetchObservationArchive({station,start,end,fetchImpl:async()=>new Response('fail',{status:503})}),/HTTP 503/);
 for(const d of [{features:[]},page([],path+'?cursor=x'),page([obs('invalid')])])await assert.rejects(fixture([d]).run());
});
const plan=()=>({captured_at:'2026-10-25T23:00:00Z',cases:[{city:'Sample',station:{id:station,distance_km:5},forecast_issued_at:'2026-10-25T22:00:00Z',captured_at:'2026-10-25T22:30:00Z',hourly:[{time:'2026-10-26T01:00:00Z',temperature_c:20},{time:'2026-10-26T02:00:00Z',temperature_c:22}]}]});
test('evaluation reports bias, MAE, RMSE, quality and missingness without a retrospective baseline',()=>{
 const archives=[{station,complete:true,observations:[obs('2026-10-26T01:15:00Z',68,'V','wmoUnit:degF').properties,obs('2026-10-26T01:55:00Z',20).properties]}];const r=evaluateForecastPlan(plan(),archives,{now:new Date('2026-10-26T03:00:00Z')});assert.equal(r.paired_hours,2);assert.equal(r.mae_c,1);assert.equal(r.rmse_c,Math.sqrt(2));assert.equal(r.bias_c,1);assert.equal(r.baseline_available,false);assert.equal(r.skill_relative_to_baseline_measured,false);assert.equal(r.pairs[0].offset_seconds,900);
 const missing=evaluateForecastPlan(plan(),[{station,complete:true,observations:[]}],{now:new Date('2026-10-26T03:00:00Z')});assert.equal(missing.missing_hours,2);assert.equal(missing.mae_c,null);assert.equal(missing.coverage_fraction,0);
});
test('temperature truth refuses bad, missing, unknown quality flags, nulls, nonfinite values and wrong units',()=>{
 for(const flag of ['B','T','Q','Z','X','UNKNOWN',undefined])assert.equal(observedTemperature(obs(end,20,flag).properties),flag===undefined?20:null);
 const missing=obs(end).properties;delete missing.temperature.qualityControl;assert.equal(observedTemperature(missing),null);
 for(const v of [null,Infinity,NaN,71,-101,'20'])assert.equal(observedTemperature(obs(end,v).properties),null);
 assert.equal(observedTemperature(obs(end,20,'V','unknown').properties),null);assert.equal(observedTemperature(obs(end,0,'G').properties),0);
});
test('invalid prospective timing, noncontiguous targets, partial archives and immature targets are refused',()=>{
 for(const change of [p=>p.captured_at='2026-10-26T01:00:00Z',p=>p.cases[0].hourly[1].time='2026-10-26T03:00:00Z',p=>p.cases[0].station.distance_km=51,p=>p.cases[0].forecast_issued_at='2026-10-26T00:00:00Z']){const p=plan();change(p);assert.throws(()=>validateForecastPlan(p));}
 assert.throws(()=>evaluateForecastPlan(plan(),[{station,complete:false}],{now:new Date('2026-10-27T00:00:00Z')}),/Incomplete/);assert.throws(()=>evaluateForecastPlan(plan(),[],{now:new Date('2026-10-26T02:00:00Z')}),/matured/);
});

test('a frozen persistence baseline uses the identical forecast-observation pairs and reports negative skill honestly',()=>{
 const p=plan();p.cases[0].baseline={kind:'persistence_temperature',station_id:station,observed_at:'2026-10-25T22:00:00Z',temperature_c:21};const archive={station,complete:true,observations:[obs('2026-10-26T01:00:00Z',21).properties,obs('2026-10-26T02:00:00Z',20).properties]};
 const r=evaluateForecastPlan(p,[archive],{now:new Date('2026-10-26T03:00:00Z')});assert.equal(r.mae_c,1.5);assert.equal(r.persistence_baseline.mae_c,0.5);assert.equal(r.persistence_baseline.paired_hours,r.paired_hours);assert.equal(r.mae_skill_vs_persistence,-2);assert.equal(r.skill_relative_to_baseline_measured,true);
 const none=evaluateForecastPlan(p,[{station,complete:true,observations:[]}],{now:new Date('2026-10-26T03:00:00Z')});assert.equal(none.skill_relative_to_baseline_measured,false);assert.equal(none.mae_skill_vs_persistence,null);
});
test('baseline hindsight, stale measurements, mixed designs and wrong-station values are rejected',()=>{
 const base={kind:'persistence_temperature',station_id:station,observed_at:'2026-10-25T22:00:00Z',temperature_c:21};
 for(const change of [b=>b.observed_at='2026-10-25T23:30:00Z',b=>b.observed_at='2026-10-25T19:00:00Z',b=>b.station_id='KBBB',b=>b.temperature_c=null,b=>b.kind='future_truth']){const p=plan();p.cases[0].baseline={...base};change(p.cases[0].baseline);assert.throws(()=>validateForecastPlan(p));}
 const p=plan();p.cases.push({...p.cases[0],baseline:base});assert.throws(()=>validateForecastPlan(p),/Every location/);
});
