// Entirely synthetic integration fixture; no original pilot or external data.
import {createHash} from 'node:crypto';
import {verifiedProtocolBytes,protocolSchedule,accountProtocolCaptures} from '../../tools/lib/weather-protocol.mjs';
import {verifyCaptureArtifacts} from '../../tools/lib/weather-capture-artifacts.mjs';
import {fetchObservationArchive,evaluateForecastPlan} from '../../tools/lib/weather-evaluation.mjs';
import {analyzeProtocolRows} from '../../tools/lib/weather-protocol-analysis.mjs';
const ORIGIN='https://api.weather.gov',HOUR=3600000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const iso=time=>new Date(time).toISOString();
export async function syntheticProtocolFlow({badArtifactKeys=[],badTruthKeys=[]}={}){
  const fixtureProtocol={protocol_id:'referenceforge-weather-prospective-v1',schedule:{consecutive_utc_days:14,forecast_hours_per_location_per_day:24,capture_window_minutes:15,planned_target_hours:1008},locations:[{name:'A',station:'KAAA',lat:0,lon:0},{name:'B',station:'KBBB',lat:1,lon:1},{name:'C',station:'KCCC',lat:2,lon:2}],baseline:{temperature_quality_flags:['C','S','V','G'],maximum_observation_age_minutes:90},truth:{matching_window_minutes:30}};
  const frozenBytes=JSON.stringify(fixtureProtocol),protocol=verifiedProtocolBytes(frozenBytes,sha(frozenBytes)),owner='2026-05-01T12:00:00Z',slots=protocolSchedule(protocol,owner),asOf='2026-05-17T00:00:00Z';
  const captures=[],rows=[],evidence=[];let mockedArchiveReads=0;
  for(let day=0;day<slots.length;day++)for(const location of protocol.locations){
    const slot=slots[day],time=Date.parse(slot),key=day+':'+location.name,forecastURL=ORIGIN+'/gridpoints/AAA/1,1/forecast/hourly';
    const captured_at=iso(time+5*60000),baselineFetch=iso(time+4*60000),forecastFetch=iso(time+3*60000),hourly=Array.from({length:24},(_,i)=>({time:iso(time+(i+1)*HOUR),temperature_c:21}));
    const capture={protocol_id:protocol.protocol_id,slot,location:location.name,captured_at,runtime_version:'0.5.4',baseline:{station:location.station,coordinates:[location.lon,location.lat],observed_at:iso(time-5*60000),fetched_at:baselineFetch,temperature_c:22,quality_control:'V'},forecast:{issued_at:iso(time-30*60000),fetched_at:forecastFetch,hourly},artifacts:[]};
    const documents={point:{type:'Feature',geometry:{type:'Point',coordinates:[location.lon,location.lat]},properties:{forecastHourly:forecastURL}},station:{type:'Feature',geometry:{type:'Point',coordinates:[location.lon,location.lat]},properties:{stationIdentifier:location.station}},baseline:{type:'Feature',properties:{station:ORIGIN+'/stations/'+location.station,timestamp:capture.baseline.observed_at,temperature:{value:22,unitCode:'wmoUnit:degC',qualityControl:'V'}}},forecast:{type:'Feature',properties:{updateTime:capture.forecast.issued_at,generatedAt:iso(time-29*60000),periods:hourly.map(h=>({startTime:h.time,endTime:iso(Date.parse(h.time)+HOUR),temperature:21,temperatureUnit:'C'}))}}};
    const urls={point:ORIGIN+'/points/'+location.lat+','+location.lon,station:ORIGIN+'/stations/'+location.station,baseline:ORIGIN+'/stations/'+location.station+'/observations/latest',forecast:forecastURL};
    const records=Object.entries(documents).map(([role,doc])=>{const bytes=Buffer.from(JSON.stringify(doc)),fetched_at=role==='baseline'?baselineFetch:role==='forecast'?forecastFetch:iso(time+60000);capture.artifacts.push({role,url:urls[role],fetched_at,sha256:sha(bytes)});return {role,url:urls[role],fetched_at,status:200,bytes};});
    captures.push(capture);
    if(badArtifactKeys.includes(key))records.find(r=>r.role==='forecast').bytes=Buffer.from('{}');
    try{verifyCaptureArtifacts(protocol,slot,location.name,capture,records);}catch(error){evidence.push({key,state:'artifact_rejected',missing_hours:24,error:error.message});for(const h of hourly)rows.push({slot,location:location.name,time:h.time,issued_at:capture.forecast.issued_at,observed_c:null,missing_reason:'capture_missing'});continue;}
    const observations=hourly.map(h=>({type:'Feature',properties:{station:ORIGIN+'/stations/'+location.station,timestamp:h.time,temperature:{value:20,unitCode:'wmoUnit:degC',qualityControl:badTruthKeys.includes(key)?'Z':'V'}}})).reverse();
    const archive=await fetchObservationArchive({station:location.station,start:iso(time+HOUR/2),end:iso(time+24.5*HOUR),fetchImpl:async()=>{mockedArchiveReads++;return new Response(JSON.stringify({type:'FeatureCollection',features:observations}));}});
    const plan={captured_at,cases:[{city:location.name,station:{id:location.station,distance_km:0},captured_at,forecast_issued_at:capture.forecast.issued_at,hourly,baseline:{kind:'persistence_temperature',station_id:location.station,observed_at:capture.baseline.observed_at,temperature_c:22}}]};
    const paired=evaluateForecastPlan(plan,[archive],{now:new Date(asOf)});
    for(const pair of paired.pairs)rows.push({slot,location:location.name,time:pair.time,issued_at:capture.forecast.issued_at,station:location.station,observed_at:pair.observed_at,quality_control:pair.quality_control,forecast_c:pair.forecast_c,observed_c:pair.observed_c,baseline_c:pair.baseline_c});
    for(const missing of paired.missing)rows.push({slot,location:location.name,time:missing.time,issued_at:capture.forecast.issued_at,observed_c:null,missing_reason:'temperature_or_quality_unacceptable'});
    evidence.push({key,state:paired.paired_hours===24?'synthetic_pairing_complete':'truth_missing',paired_hours:paired.paired_hours,missing_hours:paired.missing_hours,archive_pages:archive.pages.length});
  }
  const metadata=accountProtocolCaptures(protocol,owner,captures,{asOf}),analysis=analyzeProtocolRows(protocol,owner,rows,{asOf});
  return {synthetic_fixture_only:true,protocol_sha256:sha(frozenBytes),metadata_only_captured_hours:metadata.valid_captured_hours,artifact_checked_capture_hours:evidence.filter(e=>e.state!=='artifact_rejected').length*24,mocked_archive_reads:mockedArchiveReads,real_network_calls:0,evidence,analysis,collection_started:false,owner_finalization_verified:false,scope:'Synthetic cross-module integration only. No independent transport, pre-target attestation, real observation collection or forecast performance result.'};
}
