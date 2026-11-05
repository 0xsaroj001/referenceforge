import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeather,windRange } from '../src/weather.mjs';
import { createUnifiedHandler } from '../src/unified.mjs';
import { weatherDescriptor } from '../tools/render-weather-miner.mjs';

const NOW=Date.parse('2026-11-01T05:30:00Z'),coord={lat:25.7617,lon:-80.1918},origin='https://api.weather.gov';
function fixture(change={}){
  let clock=NOW;const calls=[];
  const station=(id,offset=0)=>({type:'Feature',geometry:{type:'Point',coordinates:[coord.lon+offset,coord.lat]},properties:{stationIdentifier:id,name:id}});
  const alert=(id,event='Hurricane Warning',extra={})=>({properties:{id,event,status:'Actual',messageType:'Alert',effective:'2026-11-01T04:00:00Z',onset:'2026-11-01T04:00:00Z',expires:'2026-11-01T12:00:00Z',severity:'Severe',instruction:'Follow official local instructions.',...extra}});
  const data={point:{type:'Feature',properties:{timeZone:'America/New_York',forecastHourly:origin+'/gridpoints/MFL/1,1/forecast/hourly',observationStations:origin+'/gridpoints/MFL/1,1/stations'}},
    stations:{type:'FeatureCollection',features:[station('KONE'),station('KTWO',0.01),station('KTHR',0.02)]},
    forecast:{properties:{updateTime:'2026-11-01T05:00:00Z',generatedAt:'2026-11-01T05:15:00Z',periods:Array.from({length:60},(_,i)=>({startTime:new Date(Date.parse('2026-11-01T06:00:00Z')+i*3600000).toISOString(),endTime:new Date(Date.parse('2026-11-01T07:00:00Z')+i*3600000).toISOString(),temperature:68+i%4,temperatureUnit:'F',windSpeed:'5 to 10 mph',windDirection:'NE',shortForecast:'Chance Rain',probabilityOfPrecipitation:{unitCode:'wmoUnit:percent',value:i%5*20}}))}},
    alerts:{type:'FeatureCollection',features:[alert('actual'),alert('test','Tornado Warning',{status:'Test'}),alert('cancel','Hurricane Warning',{messageType:'Cancel'}),alert('expired','Hurricane Warning',{expires:'2026-11-01T04:00:00Z'}),alert('heat','Heat Advisory'),alert('later','Winter Storm Watch',{onset:'2026-11-03T00:00:00Z'}),alert('actual')]}};
  const observation=id=>({type:'Feature',properties:{station:origin+'/stations/'+id,timestamp:'2026-11-01T05:00:00Z',temperature:{value:20,unitCode:'wmoUnit:degC',qualityControl:'V'},windSpeed:{value:2,unitCode:'wmoUnit:m_s-1',qualityControl:'V'},relativeHumidity:{value:50,unitCode:'wmoUnit:percent'},textDescription:'Cloudy'}});
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});const path=new URL(url).pathname;
    let body=path.startsWith('/points/')?structuredClone(data.point):path.endsWith('/forecast/hourly')?structuredClone(data.forecast):path.endsWith('/stations')?structuredClone(data.stations):path.endsWith('/observations')?{type:'FeatureCollection',features:[]}:path.includes('/observations/')?observation(path.split('/')[2]):structuredClone(data.alerts);
    const result=await change.mutate?.(body,path);if(result instanceof Response)return result;if(result!==undefined)body=result;
    return Response.json(body,{headers:{'cache-control':'public, max-age=300'}});
  };
  const cache=new Map(),service=createWeather({fetchImpl,now:()=>new Date(clock),cache,timeoutMs:1000});
  return {service,data,calls,cache,tick:ms=>clock+=ms};
}
test('weather descriptor retains all seven intents and adds exactly three scoped endpoints',()=>{
  const d=weatherDescriptor();assert.equal(d.semantics.supported_intents.length,10);assert.equal(new Set(d.semantics.supported_intents).size,10);assert.equal(d.id,1900999000);assert.equal(d.slug,'referenceforge-numeric');
  assert.equal(d.semantics.signal_mapping.label_field,'score_value');for(const e of d.endpoints.slice(-3)){assert.match(e.description,/US/);assert.deepEqual(e.params.query.required.map(x=>x.name),['lat','lon']);}
});
test('forecast preserves exact requested hours, F-to-C, wind ranges, probabilities and attribution',async()=>{
  const f=fixture(),a=await f.service.forecast({...coord,hours:24});assert.equal(a.hourly.length,24);assert.equal(a.window.start_time,'2026-11-01T06:00:00.000Z');assert.equal(a.window.end_time,'2026-11-02T06:00:00.000Z');
  assert.equal(a.hourly[0].temperature_c,20);assert.deepEqual(a.hourly[0].wind_speed_kmh,{min:8.047,max:16.093});assert.equal(a.metrics.precipitation_probability_max,80);assert.equal(a.probability_complete,true);
  assert.equal(a.sources.length,2);assert(a.sources.every(s=>/^[a-f0-9]{64}$/.test(s.payload_sha256)));assert.match(a.score_value,/forecast/);assert.equal(a.data_kind,'official_hourly_forecast');assert.match(a.attribution.name,/NOAA/);
});
test('forecast handles explicit UTC start and offsets across a DST transition',async()=>{
  const f=fixture();f.data.forecast.properties.periods[0].startTime='2026-11-01T01:00:00-05:00';f.data.forecast.properties.periods[0].endTime='2026-11-01T02:00:00-05:00';
  const a=await f.service.forecast({...coord,hours:2,start_time:'2026-11-01T06:00:00Z',metric:'temperature_max'});assert.equal(a.hourly.length,2);assert.equal(a.score_value,'20.556');
});
test('forecast refuses a partial, duplicated or stale window rather than silently shifting it',async()=>{
  for(const mutate of [d=>d.properties.periods.splice(1,1),d=>d.properties.periods[1]=d.properties.periods[0],d=>d.properties.updateTime='2026-10-30T00:00:00Z']){
    const f=fixture({mutate:(d,path)=>{if(path.endsWith('/hourly'))mutate(d);return d;}});await assert.rejects(f.service.forecast({...coord,hours:24}),/cover every|older than 24/);
  }
});
test('missing probability is disclosed in summary and refused when it is the requested value',async()=>{
  const f=fixture();f.data.forecast.properties.periods[0].probabilityOfPrecipitation.value=null;
  const a=await f.service.forecast({...coord,hours:2});assert.equal(a.probability_complete,false);assert.equal(a.metrics.precipitation_probability_max,null);assert.match(a.summary,/unavailable/);
  await assert.rejects(f.service.forecast({...coord,hours:2,metric:'precipitation_probability_max'}),/unavailable/);
});
test('calm is a real zero while malformed wind units cannot become zero',()=>{
  assert.deepEqual(windRange('Calm'),{min:0,max:0});assert.deepEqual(windRange('10 kt'),{min:18.52,max:18.52});for(const s of ['unknown','10 knots?','10 to 5 mph',null])assert.throws(()=>windRange(s));
});
test('current weather is a recent identified station measurement with units and distance',async()=>{
  const a=await fixture().service.current({...coord,metric:'wind_speed'});assert.equal(a.score_value,'7.2');assert.equal(a.data_kind,'station_observation');assert.equal(a.station.id,'KONE');assert.equal(a.station.distance_km,0);assert.equal(a.age_seconds,1800);assert.match(a.summary,/not a measurement at the exact/);
});
test('nearest stale station may be replaced only by a disclosed fresh nearby station',async()=>{
  const f=fixture({mutate:(d,path)=>{if(path.includes('/KONE/'))d.properties.timestamp='2026-10-31T00:00:00Z';return d;}});
  const a=await f.service.current(coord);assert.equal(a.station.id,'KTWO');assert(a.station.distance_km>0);assert.equal(f.calls.filter(x=>x.url.includes('/observations/')).length,2);
});
test('current weather refuses stale/future measurements, no nearby stations or wrong station identity',async()=>{
  for(const mutate of [(d,path)=>{if(path.includes('/observations/'))d.properties.timestamp='2026-10-31T00:00:00Z';return d;},(d,path)=>{if(path.includes('/observations/'))d.properties.timestamp='2026-11-02T00:00:00Z';return d;},(d,path)=>{if(path.endsWith('/stations'))d.features.forEach(x=>x.geometry.coordinates=[0,0]);return d;},(d,path)=>{if(path.includes('/observations/'))d.properties.station=origin+'/stations/EVIL';return d;}]){
    const f=fixture({mutate});await assert.rejects(f.service.current(coord),/observation|station|identity/);assert(f.calls.length<=6);
  }
});
test('missing or rejected observation fields never become fabricated numeric answers',async()=>{
  for(const [field,value] of [['temperature',null],['windSpeed',null],['relativeHumidity',null]]){
    const metric={temperature:'temperature',windSpeed:'wind_speed',relativeHumidity:'humidity'}[field];
    const f=fixture({mutate:(d,path)=>{if(path.includes('/observations/'))d.properties[field].value=value;return d;}});await assert.rejects(f.service.current({...coord,metric}),/observation/);
  }
  const f=fixture({mutate:(d,path)=>{if(path.includes('/observations/'))d.properties.temperature.qualityControl='Z';return d;}});await assert.rejects(f.service.current(coord),{code:'NO_FRESH_OBSERVATION'});
});
test('alerts include only actual matching active/upcoming warnings, deduplicate and preserve instructions',async()=>{
  const a=await fixture().service.alerts({...coord,metric:'alert_count'});assert.equal(a.alert_count,1);assert.equal(a.score_value,'1');assert.equal(a.max_severity,3);assert.equal(a.alerts[0].instruction,'Follow official local instructions.');assert.equal(a.all_clear,false);
});
test('valid empty alerts differ from failed, paginated or malformed alerts',async()=>{
  const empty=fixture();empty.data.alerts.features=[];const a=await empty.service.alerts(coord);assert.equal(a.alert_count,0);assert.equal(a.all_clear,false);assert.match(a.summary,/does not mean no storm/);
  for(const mutate of [(d,path)=>path==='/alerts'?new Response('unavailable',{status:503}):d,(d,path)=>{if(path==='/alerts')d.pagination={next:'https://api.weather.gov/alerts?cursor=next'};return d;},(d,path)=>{if(path==='/alerts')delete d.features[0].properties.expires;return d;}]){
    await assert.rejects(fixture({mutate}).service.alerts(coord),/unavailable|incomplete|Malformed/);
  }
});
test('input errors have no source calls; no guessed location, arbitrary URL or misleading window',async()=>{
  for(const p of [{},{lat:91,lon:0},{lat:0,lon:181},{...coord,source_url:'https://example.com'},{...coord,question:'New York tomorrow?'},{...coord,hours:0},{...coord,hours:49},{...coord,start_time:'2026-11-01T01:00:00-04:00'},{...coord,start_time:'2026-10-31T01:00:00Z'},{...coord,metric:'hurricane_prediction'}]){
    const f=fixture();await assert.rejects(f.service.forecast(p));assert.equal(f.calls.length,0);
  }
});
test('coverage refusal and untrusted linked source are explicit with no SSRF',async()=>{
  const outside=fixture({mutate:(d,path)=>path.startsWith('/points/')?new Response('{}',{status:404}):d});await assert.rejects(outside.service.alerts(coord),/outside supported/);
  const f=fixture();f.data.point.properties.forecastHourly='https://example.com/steal';await assert.rejects(f.service.forecast(coord),/unexpected linked/);assert.equal(f.calls.length,1);
});
test('cached bytes are revalidated and observation age cannot be extended by cache lifetime',async()=>{
  const f=fixture();await f.service.current(coord);const loads=f.calls.length;await f.service.current(coord);assert.equal(f.calls.length,loads);
  f.tick(2*3600000);await assert.rejects(f.service.current(coord),/observation/);
  const g=fixture();await g.service.forecast(coord);const k=[...g.cache.keys()].find(k=>k.endsWith('/hourly'));const entry=g.cache.get(k);entry.text='{}';await g.service.forecast(coord);assert.equal(g.calls.length,3);
});
test('HTTP weather mappings preserve text/scalars, reject bad inputs and preserve old health versions',async()=>{
  const f=fixture(),h=createUnifiedHandler({weather:true,expanded:true,weatherMiner:f.service});
  for(const [path,intent] of [['forecast','WEATHER_FORECAST'],['current','WEATHER_CHECK'],['alerts','STORM_ALERT']]){
    const r=await h(new Request(`https://test/weather/${path}?lat=25.7617&lon=-80.1918`));assert.equal(r.status,200);const a=await r.json();assert.equal(a.intent,intent);assert.equal(typeof a.score_value,'string');
    const invalid=await h(new Request('https://test/weather/'+path));assert.equal(invalid.status,422);assert.equal(Object.hasOwn(await invalid.json(),'score_value'),false);
  }
  assert.equal((await (await h(new Request('https://test/health'))).json()).supported_intents.length,10);
  assert.equal((await (await createUnifiedHandler({expanded:true})(new Request('https://test/health'))).json()).version,'0.4.0');
});

test('forecast distinguishes issue age from generated response age',async()=>{const f=fixture();f.data.forecast.properties.updateTime='2026-10-31T17:00:00Z';const a=await f.service.forecast(coord);assert.equal(a.forecast_issue_age_hours,12.5);assert.match(a.summary,/2026-10-31T17:00:00Z/);const g=fixture();g.data.forecast.properties.generatedAt='2026-11-01T01:00:00Z';await assert.rejects(g.service.forecast(coord),/generation is older/);});

test('current observations refuse subjective-bad, temporal-only and unknown QC flags instead of claiming verified weather',async()=>{
  for(const flag of ['B','T','UNKNOWN','']){const f=fixture({mutate:(d,path)=>{if(path.includes('/observations/'))d.properties.temperature.qualityControl=flag;return d;}});await assert.rejects(f.service.current(coord),/observation|quality/);}
  for(const flag of ['C','S','V','G']){const f=fixture({mutate:(d,path)=>{if(path.includes('/observations/'))d.properties.temperature.qualityControl=flag;return d;}});const a=await f.service.current(coord);assert.equal(a.verified_answer,true);assert.equal(a.observation_quality.temperature,flag);assert.equal(a.observation_quality.humidity,'not_supplied');}
});

test('bad nearest-station measurements can use the next fresh source without returning the rejected value',async()=>{const f=fixture({mutate:(d,path)=>{if(path.includes('/stations/KONE/observations/')){d.properties.temperature.qualityControl='B';d.properties.temperature.value=69;}return d;}});const a=await f.service.current(coord);assert.equal(a.station.id,'KTWO');assert.equal(a.metrics.temperature,20);assert.equal(a.observation_quality.temperature,'V');assert.equal(f.calls.filter(x=>x.url.includes('/observations/')).length,2);});

function historyObservation(timestamp='2026-11-01T05:00:00Z',temperature=20){return {type:'Feature',properties:{station:origin+'/stations/KONE',timestamp,temperature:{value:temperature,unitCode:'wmoUnit:degC',qualityControl:'V'},windSpeed:{value:0,unitCode:'wmoUnit:km_h-1',qualityControl:'V'},relativeHumidity:{value:50,unitCode:'wmoUnit:percent',qualityControl:'V'}}};}
function blankLatest(d,path){if(path.includes('/observations/latest'))d.properties.temperature.value=null;return d;}
test('blank latest reports may use one bounded same-station history page without relaxing age, distance or source budget',async()=>{
 const f=fixture({mutate:(d,path)=>path.endsWith('/observations')?{type:'FeatureCollection',features:[historyObservation('2026-11-01T05:20:00Z',null),historyObservation()],pagination:{next:'https://example.com/never-follow'}}:blankLatest(d,path)});
 const a=await f.service.current(coord);assert.equal(a.observation_selection,'recent_valid_same_station_report');assert.equal(a.station.id,'KONE');assert.equal(a.observed_at,'2026-11-01T05:00:00Z');assert.equal(a.metrics.temperature,20);assert.equal(a.metrics.wind_speed,0);assert.equal(a.history_lookback_minutes,90);assert.equal(a.history_records_examined,2);assert.equal(a.source_http_requests,6);assert.equal(f.calls.length,6);assert(f.calls.every(c=>c.url.startsWith(origin+'/')));
});
test('history never turns stale, future, rejected, wrong-station, unordered or oversized data into current weather',async()=>{
 for(const [record,code]of [[historyObservation('2026-11-01T03:59:00Z'),'NO_FRESH_OBSERVATION'],[historyObservation('2026-11-01T05:36:00Z'),'NO_FRESH_OBSERVATION'],[{...historyObservation(),properties:{...historyObservation().properties,station:origin+'/stations/EVIL'}},'INVALID_SOURCE']]){const f=fixture({mutate:(d,path)=>path.endsWith('/observations')?{type:'FeatureCollection',features:[record]}:blankLatest(d,path)});await assert.rejects(f.service.current(coord),{code});assert(f.calls.length<=6);}
 for(const features of [[historyObservation('2026-11-01T05:00:00Z'),historyObservation('2026-11-01T05:20:00Z')],[historyObservation(),historyObservation('2026-11-01T05:00:00Z',21)],Array.from({length:33},()=>historyObservation())]){const f=fixture({mutate:(d,path)=>path.endsWith('/observations')?{type:'FeatureCollection',features}:blankLatest(d,path)});await assert.rejects(f.service.current(coord),{code:'INVALID_SOURCE'});}
 const bad=historyObservation();bad.properties.temperature.qualityControl='B';const f=fixture({mutate:(d,path)=>path.endsWith('/observations')?{type:'FeatureCollection',features:[bad]}:blankLatest(d,path)});await assert.rejects(f.service.current(coord),{code:'NO_FRESH_OBSERVATION'});
});
test('an invalid optional measurement stays unavailable without suppressing a valid requested temperature',async()=>{
 const f=fixture({mutate:(d,path)=>{if(path.includes('/observations/latest'))d.properties.windSpeed.qualityControl='B';return d;}}),a=await f.service.current({...coord,metric:'temperature'});assert.equal(a.score_value,'20');assert.equal(a.metrics.wind_speed,null);assert.deepEqual(a.unavailable_measurements,['wind_speed']);assert.equal(a.observation_quality.wind_speed,'B');assert.equal(a.source_http_requests,3);
 const summary=await f.service.current(coord);assert.match(summary.summary,/wind unavailable/);assert.equal(summary.metrics.wind_speed,null);
 await assert.rejects(f.service.current({...coord,metric:'wind_speed'}),{code:'NO_FRESH_OBSERVATION'});
});
test('a history source failure is explicit and never becomes a fabricated successful observation',async()=>{
 const f=fixture({mutate:(d,path)=>path.endsWith('/observations')?new Response('unavailable',{status:503}):blankLatest(d,path)});await assert.rejects(f.service.current(coord),{code:'WEATHER_SOURCE_UNAVAILABLE'});
});
