import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateProtocol,verifiedProtocolBytes,protocolSchedule,validateProtocolCapture,accountProtocolCaptures} from '../tools/lib/weather-protocol.mjs';
const protocol=()=>({protocol_id:'referenceforge-weather-prospective-v1',schedule:{consecutive_utc_days:14,forecast_hours_per_location_per_day:24,capture_window_minutes:15,planned_target_hours:1008},locations:[{name:'A',station:'KAAA',lat:0,lon:0},{name:'B',station:'KBBB',lat:1,lon:1},{name:'C',station:'KCCC',lat:2,lon:2}],baseline:{temperature_quality_flags:['C','S','V','G'],maximum_observation_age_minutes:90},truth:{matching_window_minutes:30}});
const owner='2026-05-01T12:00:00.000Z',slot='2026-05-02T12:00:00.000Z',sha='a'.repeat(64);
function capture(){return {protocol_id:protocol().protocol_id,slot,location:'A',captured_at:'2026-05-02T12:05:00Z',runtime_version:'0.5.4',baseline:{station:'KAAA',coordinates:[0.1,0.1],observed_at:'2026-05-02T11:55:00Z',fetched_at:'2026-05-02T12:04:00Z',temperature_c:20,quality_control:'V'},forecast:{issued_at:'2026-05-02T11:30:00Z',fetched_at:'2026-05-02T12:03:00Z',hourly:Array.from({length:24},(_,i)=>({time:new Date(Date.parse(slot)+(i+1)*3600000).toISOString(),temperature_c:20+i/10}))},artifacts:[{role:'baseline',url:'https://api.weather.gov/stations/KAAA/observations/latest',sha256:sha,fetched_at:'2026-05-02T12:04:00Z'},{role:'forecast',url:'https://api.weather.gov/gridpoints/AAA/1,1/forecast/hourly',sha256:sha,fetched_at:'2026-05-02T12:03:00Z'}]};}
test('protocol bytes are pinned and fixed schedule cannot drift by location, count or limits',()=>{
  const p=protocol(),text=JSON.stringify(p),hash=createHash('sha256').update(text).digest('hex');assert.deepEqual(verifiedProtocolBytes(text,hash),p);assert.throws(()=>verifiedProtocolBytes(text+' ',hash),/hash/);
  for(const mutate of [p=>p.schedule.consecutive_utc_days=15,p=>p.schedule.capture_window_minutes=60,p=>p.schedule.planned_target_hours=999,p=>p.locations[1].station='KAAA',p=>p.baseline.maximum_observation_age_minutes=120,p=>p.locations[0].lat=91]){const p=protocol();mutate(p);assert.throws(()=>validateProtocol(p));}
});
test('anchor is the first noon at least twenty-four hours after verification, across dates and leap day',()=>{
  const p=protocol(),a=protocolSchedule(p,owner);assert.equal(a[0],slot);assert.equal(a.length,14);assert.equal(a.at(-1),'2026-05-15T12:00:00.000Z');
  assert.equal(protocolSchedule(p,'2026-05-01T12:00:00.001Z')[0],'2026-05-03T12:00:00.000Z');assert.equal(protocolSchedule(p,'2028-02-28T11:00:00Z')[0],'2028-02-29T12:00:00.000Z');assert.throws(()=>protocolSchedule(p,'bad'));
});
test('valid fixed-station capture keeps all targets, runtime version and metadata digest',()=>{
  const r=validateProtocolCapture(protocol(),slot,'A',capture());assert.equal(r.target_hours,24);assert(r.station_distance_km<50);assert.match(r.capture_sha256,/^[a-f0-9]{64}$/);assert.match(r.scope,/not proof/);
});
test('late/early capture, changed station, stale or future baseline and invalid QC are refused',()=>{
  const mutations=[c=>c.captured_at='2026-05-02T12:15:00.001Z',c=>c.captured_at='2026-05-02T11:59:59Z',c=>c.baseline.station='KBBB',c=>c.baseline.coordinates=[5,5],c=>c.baseline.observed_at='2026-05-02T10:34:59Z',c=>c.baseline.observed_at='2026-05-02T12:04:01Z',c=>c.baseline.fetched_at='2026-05-02T12:05:01Z',c=>c.baseline.quality_control='Z',c=>c.baseline.temperature_c=null,c=>c.runtime_version=''];
  for(const mutate of mutations){const c=capture();mutate(c);assert.throws(()=>validateProtocolCapture(protocol(),slot,'A',c));}
});
test('shifted/missing/reordered predictions and post-capture forecast artifacts cannot pass',()=>{
  for(const mutate of [c=>c.forecast.hourly.shift(),c=>c.forecast.hourly.reverse(),c=>c.forecast.hourly[0].temperature_c=Infinity,c=>c.forecast.issued_at='2026-05-02T12:05:01Z',c=>c.artifacts[0].url='https://evil.test/x',c=>c.artifacts[0].url='https://api.weather.gov/stations/KAAA/observationsEVIL',c=>c.artifacts[0].sha256='bad',c=>c.artifacts[1].fetched_at='2026-05-02T12:06:00Z']){const c=capture();mutate(c);assert.throws(()=>validateProtocolCapture(protocol(),slot,'A',c));}
});
test('accounting preserves the full denominator, missing closed slots and future pending slots',()=>{
  const r=accountProtocolCaptures(protocol(),owner,[capture()],{asOf:'2026-05-02T12:15:00Z'});assert.equal(r.planned_target_hours,1008);assert.equal(r.valid_captured_hours,24);assert.equal(r.missing_capture_hours,48);assert.equal(r.pending_capture_hours,936);assert.equal(r.collection_started_by_this_tool,false);
  const all=accountProtocolCaptures(protocol(),owner,[],{asOf:'2026-06-01T00:00:00Z'});assert.equal(all.missing_capture_hours,1008);assert.equal(all.pending_capture_hours,0);
});
test('bad capture remains a failed slot, without rescheduling or selecting duplicate replacement',()=>{
  const bad=capture();bad.baseline.quality_control='Z';const r=accountProtocolCaptures(protocol(),owner,[bad],{asOf:'2026-05-02T12:15:00Z'});assert.equal(r.rows[0].state,'capture_invalid');assert.equal(r.missing_capture_hours,72);assert.match(r.rows[0].error,/quality/);
  assert.throws(()=>accountProtocolCaptures(protocol(),owner,[bad,capture()],{asOf:'2026-05-02T12:15:00Z'}),/Duplicate/);
  const outside=capture();outside.slot='2026-05-01T12:00:00Z';assert.throws(()=>accountProtocolCaptures(protocol(),owner,[outside],{asOf:'2026-05-02T12:15:00Z'}),/outside/);
  assert.throws(()=>accountProtocolCaptures(protocol(),owner,[capture()],{asOf:'2026-05-02T12:00:00Z'}),/future/);
});
