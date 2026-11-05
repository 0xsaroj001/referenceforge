import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWeatherAnswerWithEvidence} from '../evaluator-v2/weather-evidence.mjs';

// Original development fixtures; no private/frozen corpus or live-source claim.
function fixture(){return {
  request:{location:'25.7752,-80.2086'},
  evidence:{captured_at:'2026-11-02T12:00:00Z',
    station:{source_url:'https://api.weather.gov/stations/KMIA',payload:{type:'Feature',geometry:{type:'Point',coordinates:[-80.28704,25.79065]},properties:{stationIdentifier:'KMIA'}}},
    observation:{source_url:'https://api.weather.gov/stations/KMIA/observations/latest',payload:{type:'Feature',geometry:{type:'Point',coordinates:[-80.29,25.79]},properties:{station:'https://api.weather.gov/stations/KMIA',timestamp:'2026-11-02T11:45:00+00:00',temperature:{value:26.7,unitCode:'wmoUnit:degC',qualityControl:'V'}}}}},
  answer:{temperature_c:26.7}};}
const run=x=>checkWeatherAnswerWithEvidence(x.request,x.evidence,x.answer);

test('weather audit accepts only canonical temperature and discloses station/capture limits',()=>{
  const r=run(fixture());assert.equal(r.outcome,'accept');assert.equal(r.valid,true);assert.equal(r.station_id,'KMIA');assert(r.distance_km>7&&r.distance_km<9);assert.equal(r.source_authenticity_verified,false);assert.match(r.location_meaning,/not exact/);
  const x=fixture();assert.equal(checkWeatherAnswerWithEvidence(JSON.stringify(x.request),JSON.stringify(x.evidence),JSON.stringify(x.answer)).outcome,'accept');
});
test('exact rational Fahrenheit conversion and positive/negative half rounding are explicit',()=>{
  for(const [value,unit,expected]of [[80,'wmoUnit:degF',26.667],[32,'wmoUnit:degF',0],[-40,'wmoUnit:degF',-40],[1.2345,'wmoUnit:degC',1.235],[-1.2345,'wmoUnit:degC',-1.234],[-1.2346,'wmoUnit:degC',-1.235]]){
    const x=fixture();Object.assign(x.evidence.observation.payload.properties.temperature,{value,unitCode:unit});x.answer.temperature_c=expected;assert.equal(run(x).outcome,'accept',String(value));
  }
});
test('wrong canonical numbers, unknown claims, raw metadata and invalid types reject',()=>{
  for(const answer of [{temperature_c:26.8},{temperature_c:'26.7'},{temperature_c:NaN},{temperature_c:61},{temperature_c:26.7,finalized:true},{temperature_c:26.7,evidence:{}},{}]){const x=fixture();x.answer=answer;assert.equal(run(x).outcome,'reject');}
});
test('rational versus current Provider float rounding gaps abstain without tolerating either answer',()=>{
  for(const answer of [-65.498,-65.499,-65.49800000000002]){
    const x=fixture();x.evidence.observation.payload.properties.temperature.value=-65.4985;x.answer.temperature_c=answer;const r=run(x);assert.equal(r.outcome,'abstain');assert.equal(r.refusal,'ROUNDING_POLICY_GAP');
  }
  for(const [value,answer]of [[-65.49849,-65.498],[-65.49851,-65.499]]){
    const x=fixture();x.evidence.observation.payload.properties.temperature.value=value;x.answer.temperature_c=answer;assert.equal(run(x).outcome,'accept');x.answer.temperature_c=answer+1e-12;assert.equal(run(x).outcome,'reject');
  }
});
test('observation freshness is checked against the explicit frozen clock with inclusive limits',()=>{
  for(const [timestamp,outcome]of [['2026-11-02T10:30:00Z','accept'],['2026-11-02T10:29:59Z','abstain'],['2026-11-02T12:05:00Z','accept'],['2026-11-02T12:05:00.001Z','abstain'],['2026-11-02T12:00:00Z','accept']]){
    const x=fixture();x.evidence.observation.payload.properties.timestamp=timestamp;assert.equal(run(x).outcome,outcome,timestamp);
  }
  for(const bad of ['2026-02-30T11:45:00Z','today',null,'2026-11-02','2026-11-02T24:00:00Z']){const x=fixture();x.evidence.captured_at=bad;assert.equal(run(x).refusal,'INVALID_CAPTURE_CLOCK');}
});
test('wrong station identity, remote point, unsupported URLs and source units abstain',()=>{
  const mutations=[
    x=>x.evidence.observation.payload.properties.station='https://api.weather.gov/stations/KJFK',
    x=>x.evidence.observation.payload.geometry.coordinates=[-73.78,40.64],
    x=>x.request.location='40.64,-73.78',
    x=>x.evidence.observation.source_url='https://api.weather.gov.evil.test/stations/KMIA/observations/latest',
    x=>x.evidence.observation.source_url='https://api.weather.gov/stations/KMIA/observations/latest?secret=1',
    x=>x.evidence.station.source_url='https://user:password@api.weather.gov/stations/KMIA',
    x=>x.evidence.observation.payload.properties.temperature.unitCode='wmoUnit:K',
    x=>x.evidence.observation.payload.properties.temperature.qualityControl='X',
    x=>x.evidence.observation.payload.properties.temperature.value=null,
    x=>x.evidence.observation.payload.properties.temperature.value=-91,
  ];
  for(const mutate of mutations){const x=fixture();mutate(x);assert.equal(run(x).outcome,'abstain');}
});
test('city names, unsupported request fields and missing source captures abstain',()=>{
  for(const request of [{location:'Miami, FL'},{location:'25.77520,-80.2086'},{location:'91,0'},{location:'25.7752,-80.2086',lat:25.7752},{}]){const x=fixture();x.request=request;assert.equal(run(x).outcome,'abstain');}
  const x=fixture();delete x.evidence.station;assert.equal(run(x).refusal,'INVALID_CAPTURE_ENVELOPE');
});
test('optional GeoJSON identities must agree with station and observation time',()=>{
  const x=fixture();x.evidence.station.payload.id='https://api.weather.gov/stations/KMIA';x.evidence.observation.payload.id='https://api.weather.gov/stations/KMIA/observations/2026-11-02T11:45:00Z';assert.equal(run(x).outcome,'accept');
  for(const [target,value]of [['station','https://api.weather.gov/stations/KJFK'],['observation','https://api.weather.gov/stations/KJFK/observations/2026-11-02T11:45:00Z'],['observation','https://api.weather.gov/stations/KMIA/observations/2026-11-02T11:44:00Z']]){const y=fixture();y.evidence[target].payload.id=value;assert.equal(run(y).outcome,'abstain');}
});
test('duplicate JSON keys and getters are refused without invoking getters',()=>{
  const x=fixture();assert.equal(checkWeatherAnswerWithEvidence(x.request,x.evidence,'{"temperature_c":26.7,"temperature_c":26.8}').outcome,'reject');
  const raw=JSON.stringify(x.evidence).replace('"value":26.7','"value":26.7,"value":27');assert.equal(checkWeatherAnswerWithEvidence(x.request,raw,x.answer).refusal,'DUPLICATE_JSON_KEY');
  let calls=0;Object.defineProperty(x.evidence.observation.payload.properties.temperature,'value',{get(){calls++;return 26.7;},enumerable:true});assert.equal(run(x).refusal,'NON_DATA_PROPERTY');assert.equal(calls,0);
  const y=fixture();Object.defineProperty(y.answer,'temperature_c',{get(){calls++;return 26.7;},enumerable:true});assert.equal(run(y).outcome,'reject');assert.equal(calls,0);
});
test('inherited records, cycles, sparse arrays and oversized evidence abstain',()=>{
  const inherited=fixture();inherited.evidence.station.payload.properties=Object.create({stationIdentifier:'KMIA'});assert.equal(run(inherited).refusal,'NON_PLAIN_DATA');
  const cyclic=fixture();cyclic.evidence.loop=cyclic.evidence;assert.equal(run(cyclic).refusal,'CYCLIC_OR_SHARED_DATA');
  const sparse=fixture();delete sparse.evidence.station.payload.geometry.coordinates[0];assert.equal(run(sparse).refusal,'SPARSE_ARRAY');
  const huge=fixture();huge.evidence.extra='x'.repeat(1048577);assert.equal(run(huge).refusal,'INPUT_TOO_LARGE');
});
