// Offline byte/semantic verification. Caller-supplied timestamps and URLs are not
// an independently authenticated record of network delivery or capture time.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateProtocolCapture} from './weather-protocol.mjs';
const ORIGIN='https://api.weather.gov',HOUR=3600000;
const stamp=x=>{assert(typeof x==='string'&&Number.isFinite(Date.parse(x)),'Invalid source timestamp');return Date.parse(x);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const round=x=>Math.round(x*1000)/1000;
const temperature=(value,unit)=>{
  assert(typeof value==='number'&&Number.isFinite(value),'Missing/nonfinite source temperature');
  const c=unit==='C'||unit==='wmoUnit:degC'?value:unit==='F'||unit==='wmoUnit:degF'?(value-32)*5/9:NaN;
  assert(Number.isFinite(c)&&c>=-100&&c<=70,'Unsupported/invalid source temperature');return round(c);
};
export function verifyCaptureArtifacts(protocol,slot,locationName,capture,records){
  const metadata=validateProtocolCapture(protocol,slot,locationName,capture),location=protocol.locations.find(x=>x.name===locationName);
  assert(Array.isArray(records)&&records.length===4&&capture.artifacts.length===4,'Requires exactly point, station, baseline and forecast artifacts');
  const docs=new Map(),manifest=[];let total=0;
  for(const record of records){
    assert(['point','station','baseline','forecast'].includes(record?.role)&&!docs.has(record.role),'Unknown/duplicate artifact role');
    const matches=capture.artifacts.filter(a=>a.role===record.role);assert(matches.length===1,'Missing/duplicate capture artifact role');const expected=matches[0];
    assert(record.url===expected.url&&stamp(record.fetched_at)===stamp(expected.fetched_at)&&record.status===200,'Artifact identity, fetch time or HTTP status changed');
    assert(record.bytes instanceof Uint8Array,'Artifact must supply exact raw bytes');const bytes=record.bytes;total+=bytes.byteLength;
    assert(bytes.byteLength>0&&bytes.byteLength<=1000000&&total<=4000000,'Artifact byte budget exceeded');
    assert(sha(bytes)===expected.sha256,'Artifact raw-byte hash mismatch');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),doc=JSON.parse(text);
    docs.set(record.role,{doc,url:record.url,fetched:stamp(record.fetched_at)});manifest.push({role:record.role,url:record.url,sha256:sha(bytes),bytes:bytes.byteLength});
  }
  const point=docs.get('point'),station=docs.get('station'),baseline=docs.get('baseline'),forecast=docs.get('forecast');
  assert(point.url===ORIGIN+'/points/'+location.lat+','+location.lon&&point.doc?.type==='Feature'&&point.doc.geometry?.type==='Point','Point artifact does not identify fixed request');
  const pointCoords=point.doc.geometry.coordinates;
  assert(Array.isArray(pointCoords)&&pointCoords.length===2&&pointCoords.every(x=>typeof x==='number'&&Number.isFinite(x))&&Math.abs(pointCoords[0]-location.lon)<=0.0001&&Math.abs(pointCoords[1]-location.lat)<=0.0001,'Point source coordinates changed');
  const linked=point.doc.properties?.forecastHourly;
  assert(typeof linked==='string'&&new URL(linked).origin===ORIGIN&&/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/.test(new URL(linked).pathname)&&forecast.url===linked,'Forecast is not the fixed point linked resource');
  assert(station.url===ORIGIN+'/stations/'+location.station&&station.doc?.type==='Feature'&&station.doc.properties?.stationIdentifier===location.station&&station.doc.geometry?.type==='Point','Station source identity changed');
  assert.deepEqual(station.doc.geometry.coordinates,capture.baseline.coordinates,'Station coordinates differ from decoded source');
  assert(stamp(capture.baseline.fetched_at)===baseline.fetched&&stamp(capture.forecast.fetched_at)===forecast.fetched,'Semantic and artifact fetch times disagree');
  const stationURL=ORIGIN+'/stations/'+location.station,baselinePath=new URL(baseline.url).pathname;
  assert(baselinePath==='/stations/'+location.station+'/observations'||baselinePath.startsWith('/stations/'+location.station+'/observations/'),'Baseline endpoint changed');
  const observationDocs=baseline.doc?.type==='Feature'?[baseline.doc]:baseline.doc?.type==='FeatureCollection'&&Array.isArray(baseline.doc.features)&&baseline.doc.features.length<=32?baseline.doc.features:null;
  assert(observationDocs&&observationDocs.length,'Missing bounded source observations');const valid=[],seen=new Map();let previous=Infinity;
  for(const feature of observationDocs){
    assert(feature?.type==='Feature'&&feature.properties?.station===stationURL,'Observation source station changed');const o=feature.properties,time=stamp(o.timestamp);assert(time<=previous,'Observation history is not newest first');previous=time;
    const prior=seen.get(time);assert(!seen.has(time)||JSON.stringify(prior)===JSON.stringify(o.temperature),'Conflicting duplicate source temperature');seen.set(time,o.temperature);
    if(time>baseline.fetched||stamp(capture.captured_at)-time>90*60000||!protocol.baseline.temperature_quality_flags.includes(o.temperature?.qualityControl))continue;
    let value;try{value=temperature(o.temperature?.value,o.temperature?.unitCode);}catch{continue;}
    valid.push({time,value,quality:o.temperature.qualityControl});
  }
  assert(valid.length,'No accepted fresh pre-capture baseline in decoded source');const chosen=valid[0];
  assert(chosen.time===stamp(capture.baseline.observed_at)&&chosen.value===capture.baseline.temperature_c&&chosen.quality===capture.baseline.quality_control,'Baseline does not match newest usable decoded observation');
  const properties=forecast.doc?.properties;
  assert(forecast.doc?.type==='Feature'&&stamp(properties?.updateTime)===stamp(capture.forecast.issued_at),'Forecast source issue changed');
  const captured=stamp(capture.captured_at),generated=stamp(properties.generatedAt);
  assert(generated<=forecast.fetched&&captured-generated<=2*HOUR&&captured-stamp(properties.updateTime)<=24*HOUR,'Forecast generation/issue is unavailable or stale');
  assert(Array.isArray(properties.periods)&&properties.periods.length<=200,'Invalid source forecast period budget');
  const start=stamp(slot)+HOUR,end=start+24*HOUR;
  const selected=properties.periods.filter(p=>stamp(p.startTime)>=start&&stamp(p.startTime)<end).sort((a,b)=>stamp(a.startTime)-stamp(b.startTime));
  assert(selected.length===24,'Decoded forecast does not cover all fixed targets');
  for(let i=0;i<24;i++){const p=selected[i],expected=capture.forecast.hourly[i];assert(stamp(p.startTime)===stamp(expected.time)&&stamp(p.endTime)===stamp(expected.time)+HOUR,'Decoded target interval changed');assert(temperature(p.temperature,p.temperatureUnit)===expected.temperature_c,'Forecast temperature differs from decoded source');}
  return {...metadata,verification_level:'offline_bytes_and_semantics',source_bytes_match_capture_metadata:true,source_manifest:manifest,transport_authenticated:false,capture_time_independently_attested:false,collection_started:false,scope:'Exact supplied bytes/hash and decoded temperature facts agree. Source URL, fetch clock and raw bytes are caller-supplied; this does not independently authenticate NWS delivery, pre-target availability, actual collection, forecast skill or deployment.'};
}
