import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyCaptureArtifacts} from '../tools/lib/weather-capture-artifacts.mjs';
const origin='https://api.weather.gov',slot='2026-05-02T12:00:00Z';
const protocol={protocol_id:'referenceforge-weather-prospective-v1',schedule:{consecutive_utc_days:14,forecast_hours_per_location_per_day:24,capture_window_minutes:15,planned_target_hours:1008},locations:[{name:'A',station:'KAAA',lat:0,lon:0},{name:'B',station:'KBBB',lat:1,lon:1},{name:'C',station:'KCCC',lat:2,lon:2}],baseline:{temperature_quality_flags:['C','S','V','G'],maximum_observation_age_minutes:90},truth:{matching_window_minutes:30}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const forecastURL=origin+'/gridpoints/AAA/1,1/forecast/hourly',hourly=Array.from({length:24},(_,i)=>({time:new Date(Date.parse(slot)+(i+1)*3600000).toISOString(),temperature_c:20+i/10}));
 const capture={protocol_id:protocol.protocol_id,slot,location:'A',captured_at:'2026-05-02T12:05:00Z',runtime_version:'0.5.4',baseline:{station:'KAAA',coordinates:[0.1,0.1],observed_at:'2026-05-02T11:55:00Z',fetched_at:'2026-05-02T12:04:00Z',temperature_c:20,quality_control:'V'},forecast:{issued_at:'2026-05-02T11:30:00Z',fetched_at:'2026-05-02T12:03:00Z',hourly},artifacts:[]};
 const docs={point:{type:'Feature',geometry:{type:'Point',coordinates:[0,0]},properties:{forecastHourly:forecastURL}},station:{type:'Feature',geometry:{type:'Point',coordinates:[0.1,0.1]},properties:{stationIdentifier:'KAAA'}},baseline:{type:'Feature',properties:{station:origin+'/stations/KAAA',timestamp:capture.baseline.observed_at,temperature:{value:68,unitCode:'wmoUnit:degF',qualityControl:'V'}}},forecast:{type:'Feature',properties:{updateTime:capture.forecast.issued_at,generatedAt:'2026-05-02T11:31:00Z',periods:hourly.map((h,i)=>({startTime:h.time,endTime:new Date(Date.parse(h.time)+3600000).toISOString(),temperature:68+i*0.18,temperatureUnit:'F'}))}}};
 const urls={point:origin+'/points/0,0',station:origin+'/stations/KAAA',baseline:origin+'/stations/KAAA/observations/latest',forecast:forecastURL};
 const records=Object.entries(docs).map(([role,doc])=>{const bytes=Buffer.from(JSON.stringify(doc)),fetched_at=role==='baseline'?capture.baseline.fetched_at:role==='forecast'?capture.forecast.fetched_at:'2026-05-02T12:01:00Z';capture.artifacts.push({role,url:urls[role],fetched_at,sha256:hash(bytes)});return {role,url:urls[role],fetched_at,status:200,bytes};});
 return {capture,records,docs,run(){return verifyCaptureArtifacts(protocol,slot,'A',capture,records);},replace(role,doc){const record=records.find(r=>r.role===role);record.bytes=Buffer.from(JSON.stringify(doc));capture.artifacts.find(r=>r.role===role).sha256=hash(record.bytes);}};
}
test('decoded fixed-point/station, Fahrenheit baseline and all hourly values match exact supplied bytes',()=>{const f=fixture(),r=f.run();assert.equal(r.source_bytes_match_capture_metadata,true);assert.equal(r.source_manifest.length,4);assert.equal(r.transport_authenticated,false);assert.equal(r.capture_time_independently_attested,false);assert.equal(r.collection_started,false);assert.match(r.scope,/caller-supplied/);});
test('tampering, decoded text substitution, wrong HTTP status and partial/duplicate artifacts refuse',()=>{
 for(const mutate of [f=>f.records[0].bytes=Buffer.from('{}'),f=>f.records[0].bytes=f.records[0].bytes.toString(),f=>f.records[0].status=503,f=>f.records.pop(),f=>f.records[1].role='point',f=>f.records[0].fetched_at='2026-05-02T12:00:00Z']){const f=fixture();mutate(f);assert.throws(()=>f.run());}
});
test('valid hashes cannot conceal changed point/station identity, coordinates or forecast link',()=>{
 for(const [role,mutate] of [['point',d=>d.geometry.coordinates=[1,1]],['point',d=>d.geometry.coordinates=['0','0']],['point',d=>d.properties.forecastHourly=origin+'/gridpoints/BBB/2,2/forecast/hourly'],['station',d=>d.properties.stationIdentifier='KBBB'],['station',d=>d.geometry.coordinates=[0.2,0.2]],['baseline',d=>d.properties.station=origin+'/stations/KBBB']]){const f=fixture();mutate(f.docs[role]);f.replace(role,f.docs[role]);assert.throws(()=>f.run());}
});
test('baseline source values/time/QC must match metadata and be available before capture',()=>{
 for(const mutate of [d=>d.properties.temperature.value=70,d=>d.properties.timestamp='2026-05-02T11:54:00Z',d=>d.properties.timestamp='2026-05-02T12:06:00Z',d=>d.properties.temperature.qualityControl='Z',d=>d.properties.temperature.value=null,d=>d.properties.temperature.unitCode='unknown']){const f=fixture();mutate(f.docs.baseline);f.replace('baseline',f.docs.baseline);assert.throws(()=>f.run());}
 const f=fixture();f.capture.baseline.fetched_at='2026-05-02T12:04:01Z';assert.throws(()=>f.run(),/fetch times/);
});
test('bounded history chooses newest accepted measurement and refuses conflicting duplicates/order',()=>{
 const f=fixture(),valid=f.docs.baseline,newer={type:'Feature',properties:{...valid.properties,timestamp:'2026-05-02T12:00:00Z',temperature:{value:null,unitCode:'wmoUnit:degC',qualityControl:'Z'}}};
 f.replace('baseline',{type:'FeatureCollection',features:[newer,valid]});assert.equal(f.run().source_bytes_match_capture_metadata,true);
 f.replace('baseline',{type:'FeatureCollection',features:[valid,newer]});assert.throws(()=>f.run(),/newest first/);
 f.replace('baseline',{type:'FeatureCollection',features:[{...valid,properties:{...valid.properties,temperature:null}},valid]});assert.throws(()=>f.run(),/Conflicting/);
 const latest={type:'Feature',properties:{...valid.properties,timestamp:'2026-05-02T12:00:00Z'}};f.replace('baseline',{type:'FeatureCollection',features:[latest,valid]});assert.throws(()=>f.run(),/newest usable/);
});
test('forecast bytes enforce issue/generation, complete intervals, units and exact normalized values',()=>{
 for(const mutate of [d=>d.properties.updateTime='2026-05-02T11:31:00Z',d=>d.properties.generatedAt='2026-05-02T12:06:00Z',d=>d.properties.generatedAt='2026-05-02T09:00:00Z',d=>d.properties.periods.pop(),d=>d.properties.periods.push(d.properties.periods[0]),d=>d.properties.periods[0].endTime='2026-05-02T15:00:00Z',d=>d.properties.periods[0].temperatureUnit='K',d=>d.properties.periods[0].temperature=70]){const f=fixture();mutate(f.docs.forecast);f.replace('forecast',f.docs.forecast);assert.throws(()=>f.run());}
});
test('invalid UTF8, malformed JSON and oversized source bodies fail without decoding substitutions',()=>{
 for(const bytes of [Buffer.from([0xff]),Buffer.from('{'),Buffer.alloc(1000001,32)]){const f=fixture();f.records[0].bytes=bytes;f.capture.artifacts[0].sha256=hash(bytes);assert.throws(()=>f.run());}
});
