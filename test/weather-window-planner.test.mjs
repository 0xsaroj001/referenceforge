import test from 'node:test';
import assert from 'node:assert/strict';
import {planWeatherWindows} from '../src/weather-window-planner.mjs';
import {collectPlannerInputs} from '../tools/weather-window-plan.mjs';
const HOUR=3600000,now=new Date('2026-10-27T13:30:00Z'),start=Date.parse('2026-10-27T14:00:00Z'),iso=v=>new Date(v).toISOString();
function fixture(){
 const location={latitude:25.7617,longitude:-80.1918,time_zone:'America/New_York'},source=path=>({source_url:'https://api.weather.gov'+path,payload_sha256:'a'.repeat(64),fetched_at:now.toISOString()}),common={status:'ok',verified_answer:true,fallback:false,location};
 return [{...common,intent:'WEATHER_FORECAST',data_kind:'official_hourly_forecast',source_updated_at:'2026-10-27T12:00:00Z',response_generated_at:'2026-10-27T13:00:00Z',window:{start_time:iso(start),end_time:iso(start+12*HOUR),hours:12},probability_complete:true,hourly:Array.from({length:12},(_,i)=>({start_time:iso(start+i*HOUR),end_time:iso(start+(i+1)*HOUR),temperature_c:20,precipitation_probability_pct:10,wind_speed_kmh:{min:5,max:10}})),sources:[source('/points/25.7617,-80.1918'),source('/gridpoints/MFL/1,1/forecast/hourly')]},{...common,intent:'WEATHER_CHECK',data_kind:'station_observation',observed_at:'2026-10-27T13:20:00Z',age_seconds:600,station:{id:'KMIA',distance_km:12},metrics:{temperature:21},observation_quality:{temperature:'V'},sources:[source('/points/25.7617,-80.1918'),source('/stations/KMIA/observations/latest')]},{...common,intent:'STORM_ALERT',data_kind:'issued_official_alerts',checked_at:now.toISOString(),window_end:iso(now.getTime()+24*HOUR),all_clear:false,alert_count:0,alerts:[],sources:[source('/points/25.7617,-80.1918'),source('/alerts?active=true')]}];
}
const plan=(a=fixture(),p={})=>planWeatherWindows(a,{now,...p});
const warning=(begin,end)=>({id:'one',event:'High Wind Warning',onset:iso(begin),ends:null,expires:iso(end),instruction:'Follow local official instructions.',official_url:'https://api.weather.gov/alerts/one'});
test('complete inputs yield deterministic non-overlapping alternatives and explicit illustrative scope without mutating input',()=>{
 const a=fixture(),before=structuredClone(a),r=plan(a);assert.equal(r.state,'alternatives_available');assert.equal(r.windows.length,3);assert.equal(r.windows[0].start_time,iso(start));assert.equal(r.windows[1].start_time,iso(start+3*HOUR));assert.deepEqual(a,before);assert.equal(r.all_clear,false);assert.equal(r.human_review_required,true);assert.match(r.scope,/not an all-clear/);assert.match(r.probability_interpretation,/not a probability for the whole/);assert.equal(r.forecast_issued_at,a[0].source_updated_at);assert.equal(r.evidence.length,3);
});
test('ranked alternatives use maximum hourly rain then wind, never summed probabilities',()=>{
 const a=fixture();a[0].hourly.forEach((h,i)=>{h.precipitation_probability_pct=i<3?50:20;h.wind_speed_kmh.max=i<6?20:10;});const r=plan(a,{max_results:1});assert.equal(r.windows[0].start_time,iso(start+6*HOUR));assert.equal(r.windows[0].max_hourly_precipitation_probability_pct,20);assert.equal(r.windows[0].wind_speed_max_kmh,10);
});
test('official warnings block overlapping windows, keep their exact instructions and use half-open boundaries',()=>{
 const a=fixture();a[2].alert_count=1;a[2].alerts=[warning(start,start+3*HOUR)];const r=plan(a);assert.equal(r.windows[0].start_time,iso(start+3*HOUR));assert.equal(r.official_instructions[0].instruction,a[2].alerts[0].instruction);assert.equal(r.excluded_candidates.issued_alert,3);assert.equal(r.all_clear,false);
 const b=fixture();b[2].alert_count=1;b[2].alerts=[warning(start+3*HOUR,start+12*HOUR)];assert.equal(plan(b).windows[0].start_time,iso(start));
});
test('a message expiring before a stated event end cannot create a false post-warning alternative',()=>{
 const a=fixture(),alert=warning(start,start+3*HOUR);alert.ends=iso(start+12*HOUR);a[2].alert_count=1;a[2].alerts=[alert];const r=plan(a);assert.equal(r.state,'no_window_meets_thresholds');assert.equal(r.windows.length,0);assert.equal(r.excluded_candidates.issued_alert,10);assert.equal(r.official_instructions[0].ends,alert.ends);
 const b=fixture(),other=warning(start,start+12*HOUR);other.ends=iso(start+3*HOUR);b[2].alert_count=1;b[2].alerts=[other];assert.equal(plan(b).windows.length,0);
});
test('no suitable window is distinct from missing data and an empty feed never implies all-clear',()=>{
 const a=fixture();a[0].hourly.forEach(h=>h.wind_speed_kmh.max=30);const r=plan(a);assert.equal(r.state,'no_window_meets_thresholds');assert.equal(r.windows.length,0);assert(r.excluded_candidates.wind_threshold>0);assert.equal(r.all_clear,false);assert.equal(plan([]).state,'insufficient_data');
 const b=fixture();b[0].hourly.forEach(h=>h.precipitation_probability_pct=60);assert.equal(plan(b).state,'no_window_meets_thresholds');
 const c=fixture();c[0].hourly.forEach(h=>h.temperature_c=-11);assert.equal(plan(c).state,'no_window_meets_thresholds');
});
test('forecast horizon may exceed checked alert coverage; uncovered tail windows are excluded rather than labelled usable',()=>{
 const a=fixture();a[2].window_end=iso(start+4*HOUR);const r=plan(a);assert.equal(r.covered_candidate_count,2);assert(r.excluded_candidates.outside_alert_coverage>0);assert(r.windows.every(w=>Date.parse(w.end_time)<=Date.parse(a[2].window_end)));
 a[2].window_end=iso(start+2*HOUR);const no=plan(a);assert.equal(no.state,'insufficient_data');assert.equal(no.windows.length,0);
});
test('stale snapshots cannot be revived by a self-reported age, new checked time or a parsed-success flag',()=>{
 for(const mutate of [a=>a[0].source_updated_at='2026-10-25T12:00:00Z',a=>a[0].response_generated_at='2026-10-27T10:00:00Z',a=>{a[1].observed_at='2026-10-27T10:00:00Z';a[1].age_seconds=0;},a=>a[2].checked_at='2026-10-27T13:00:00Z',a=>a[2].sources[1].fetched_at='2026-10-27T12:00:00Z']){const a=fixture();mutate(a);assert.equal(plan(a).state,'insufficient_data');}
});
test('missing, duplicate, mismatched and unverified capabilities are refused',()=>{
 for(const mutate of [a=>a.pop(),a=>a.push(a[0]),a=>a[1].location={latitude:0,longitude:0},a=>a[1].data_kind='model_estimate',a=>a[0].verified_answer=false,a=>a[0].fallback=true,a=>a[1].station.distance_km=51,a=>a[1].station.id='bad-station']){const a=fixture();mutate(a);assert.equal(plan(a).state,'insufficient_data');}
});
test('missing probability, malformed wind, shifted hours, null records and unsupported quality cannot become benign numbers',()=>{
 for(const mutate of [a=>a[0].probability_complete=false,a=>a[0].hourly[0].precipitation_probability_pct=null,a=>delete a[0].hourly[0].wind_speed_kmh,a=>a[0].hourly[1].start_time=iso(start),a=>a[0].hourly[1]=null,a=>a[0].hourly[0].wind_speed_kmh={min:20,max:10},a=>a[1].observation_quality.temperature='B',a=>delete a[1].observation_quality]){const a=fixture();mutate(a);assert.equal(plan(a).state,'insufficient_data');}
});
test('source metadata, alert identities and validity intervals must be coherent',()=>{
 for(const mutate of [a=>a[0].sources=[],a=>a[0].sources[0].source_url='https://evil.test/source',a=>a[0].sources[0].payload_sha256='invalid',a=>a[0].sources[0].fetched_at='2027-01-01T00:00:00Z',a=>a[2].alert_count=1,a=>{a[2].alerts=[null];a[2].alert_count=1;},a=>{a[2].alerts=[warning(start,start-1)];a[2].alert_count=1;},a=>a[2].all_clear=true]){const a=fixture();mutate(a);assert.equal(plan(a).state,'insufficient_data');}
});
test('threshold boundaries, zero measurements and valid temperature endpoints retain exact meanings',()=>{
 const a=fixture();a[0].hourly.forEach(h=>{h.wind_speed_kmh={min:0,max:0};h.precipitation_probability_pct=0;h.temperature_c=-10;});const r=plan(a);assert.equal(r.state,'alternatives_available');assert.equal(r.windows[0].wind_speed_max_kmh,0);assert.equal(r.windows[0].temperature_min_c,-10);assert.equal(plan(a,{wind_below_kmh:0}).state,'no_window_meets_thresholds');
});
test('invalid planner settings fail explicitly without an apparent scheduling result',()=>{
 for(const options of [{duration_hours:0},{duration_hours:25},{duration_hours:1.5},{max_results:6},{wind_below_kmh:Infinity},{precip_probability_below_pct:null},{temperature_min_c:50,temperature_max_c:40},{now:new Date('bad')},{source_url:'https://evil.test'}])assert.equal(plan(fixture(),options).state,'invalid_request');
});
test('live collector preserves a failed source response and does not fabricate remaining capabilities',async()=>{
 let calls=0;const r=await collectPlannerInputs({fetchImpl:async()=>{calls++;return new Response('upstream unavailable',{status:503});}});assert.equal(calls,1);assert.equal(r.failure.code,'WEATHER_SOURCE_UNAVAILABLE');assert.equal(r.answers.length,0);assert.equal(r.captures.length,1);assert.equal(r.captures[0].status,503);assert.equal(r.captures[0].text,'upstream unavailable');assert.match(r.captures[0].payload_sha256,/^[a-f0-9]{64}$/);
});
