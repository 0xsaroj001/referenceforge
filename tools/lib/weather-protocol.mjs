// Offline experiment validation only. No collector, public endpoint or network API.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const HOUR=3600000,DAY=24*HOUR;
const instant=value=>{assert(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Invalid timestamp');return Date.parse(value);};
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const hash=text=>createHash('sha256').update(text).digest('hex');
const temperature=value=>finite(value,-100,70);

export function validateProtocol(protocol){
  assert(protocol?.protocol_id==='referenceforge-weather-prospective-v1','Unsupported protocol');
  assert(protocol.schedule?.consecutive_utc_days===14&&protocol.schedule.forecast_hours_per_location_per_day===24&&protocol.schedule.capture_window_minutes===15,'Unexpected schedule');
  assert(Array.isArray(protocol.locations)&&protocol.locations.length===3,'Requires three frozen locations');
  assert(protocol.schedule.planned_target_hours===1008,'Unexpected target denominator');
  assert(new Set(protocol.locations.map(l=>l.name)).size===3&&new Set(protocol.locations.map(l=>l.station)).size===3,'Duplicate location/station');
  for(const l of protocol.locations)assert(typeof l.name==='string'&&l.name.length>0&&/^[A-Z0-9]{3,8}$/.test(l.station)&&finite(l.lat,-90,90)&&finite(l.lon,-180,180),'Invalid fixed location');
  assert.deepEqual(protocol.baseline?.temperature_quality_flags,['C','S','V','G']);
  assert(protocol.baseline.maximum_observation_age_minutes===90&&protocol.truth?.matching_window_minutes===30,'Unexpected freshness/matching rules');
  return protocol;
}
export function verifiedProtocolBytes(text,expectedSHA256){
  assert(/^[a-f0-9]{64}$/.test(expectedSHA256)&&hash(text)===expectedSHA256,'Frozen protocol hash changed');
  return validateProtocol(JSON.parse(text));
}
export function protocolSchedule(protocol,finalizationVerifiedAt){
  validateProtocol(protocol);
  const threshold=instant(finalizationVerifiedAt)+DAY,date=new Date(threshold);
  let anchor=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),12);
  if(anchor<threshold)anchor+=DAY;
  return Array.from({length:14},(_,day)=>new Date(anchor+day*DAY).toISOString());
}
function distanceKm(location,coordinates){
  assert(Array.isArray(coordinates)&&coordinates.length===2&&finite(coordinates[0],-180,180)&&finite(coordinates[1],-90,90),'Invalid station coordinates');
  const rad=x=>x*Math.PI/180,lat=rad(coordinates[1]-location.lat),lon=rad(coordinates[0]-location.lon);
  const a=Math.sin(lat/2)**2+Math.cos(rad(location.lat))*Math.cos(rad(coordinates[1]))*Math.sin(lon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,a)));
}
export function validateProtocolCapture(protocol,slot,locationName,capture){
  validateProtocol(protocol);const start=instant(slot),location=protocol.locations.find(l=>l.name===locationName);
  assert(location,'Unknown fixed location');
  assert(new Date(start).toISOString().slice(11)==='12:00:00.000Z','Slot must start at 12:00 UTC');
  assert(capture?.protocol_id===protocol.protocol_id&&capture.location===locationName&&instant(capture.slot)===start,'Capture identity changed');
  const captured=instant(capture.captured_at);
  assert(captured>=start&&captured<=start+15*60000,'Capture missed its scheduled window');
  assert(typeof capture.runtime_version==='string'&&/^\d+\.\d+\.\d+$/.test(capture.runtime_version),'Missing runtime version');
  const baseline=capture.baseline;
  assert(baseline?.station===location.station,'Baseline station changed');
  const distance=distanceKm(location,baseline.coordinates);assert(distance<=50,'Station is outside fixed distance limit');
  const observed=instant(baseline.observed_at),fetched=instant(baseline.fetched_at);
  assert(observed<=fetched&&fetched<=captured&&captured-observed<=90*60000,'Baseline was unavailable, future or stale at capture');
  assert(temperature(baseline.temperature_c)&&protocol.baseline.temperature_quality_flags.includes(baseline.quality_control),'Invalid baseline temperature/quality');
  const forecast=capture.forecast,issued=instant(forecast?.issued_at),forecastFetched=instant(forecast?.fetched_at);
  assert(issued<=forecastFetched&&forecastFetched<=captured,'Forecast issue/fetch order is invalid');
  assert(Array.isArray(forecast.hourly)&&forecast.hourly.length===24,'Capture requires all twenty-four original predictions');
  for(let i=0;i<24;i++)assert(instant(forecast.hourly[i].time)===start+(i+1)*HOUR&&temperature(forecast.hourly[i].temperature_c),'Changed/noncontiguous target or invalid temperature');
  assert(captured<instant(forecast.hourly[0].time),'Capture must precede every target');
  assert(Array.isArray(capture.artifacts)&&capture.artifacts.length>=2&&capture.artifacts.length<=20,'Missing bounded source artifacts');
  for(const artifact of capture.artifacts){
    const url=new URL(artifact.url);assert(url.origin==='https://api.weather.gov'&&!url.username&&!url.password&&!url.hash&&/^[a-f0-9]{64}$/.test(artifact.sha256),'Invalid official artifact provenance');
    assert(instant(artifact.fetched_at)<=captured,'Artifact became available after capture');
  }
  const baselinePath='/stations/'+location.station+'/observations';
  assert(capture.artifacts.some(a=>a.role==='baseline'&&(new URL(a.url).pathname===baselinePath||new URL(a.url).pathname.startsWith(baselinePath+'/')))&&capture.artifacts.some(a=>a.role==='forecast'),'Missing fixed-station baseline or forecast artifact');
  return {slot:new Date(start).toISOString(),location:locationName,station:location.station,station_distance_km:distance,target_hours:24,capture_sha256:hash(JSON.stringify(capture)),scope:'Metadata validation only; supplied artifact hashes are not proof that bytes were fetched or match those hashes.'};
}
export function accountProtocolCaptures(protocol,finalizationVerifiedAt,captures,{asOf}={}){
  const slots=protocolSchedule(protocol,finalizationVerifiedAt);assert(Array.isArray(captures)&&captures.length<=42,'Invalid capture count');
  const cutoff=instant(asOf),byKey=new Map();
  for(const c of captures){const slot=new Date(instant(c?.slot)).toISOString();assert(slots.includes(slot)&&protocol.locations.some(l=>l.name===c.location),'Capture outside fixed schedule');const key=slot+'|'+c.location;assert(!byKey.has(key),'Duplicate capture slot; cannot select a favorable replacement');byKey.set(key,c);}
  const rows=[];
  for(const slot of slots)for(const location of protocol.locations){const capture=byKey.get(slot+'|'+location.name),closed=cutoff>=instant(slot)+15*60000;
    if(capture){assert(instant(capture.captured_at)<=cutoff,'Capture is in the future relative to accounting clock');try{rows.push({...validateProtocolCapture(protocol,slot,location.name,capture),state:'capture_valid'});}catch(e){rows.push({slot,location:location.name,state:'capture_invalid',missing_hours:24,error:e.message});}}
    else rows.push({slot,location:location.name,state:closed?'capture_missing':'capture_pending',missing_hours:closed?24:0});
  }
  return {as_of:new Date(cutoff).toISOString(),planned_target_hours:1008,valid_captured_hours:rows.filter(r=>r.state==='capture_valid').length*24,missing_capture_hours:rows.reduce((n,r)=>n+(r.missing_hours??0),0),pending_capture_hours:rows.filter(r=>r.state==='capture_pending').length*24,rows,collection_started_by_this_tool:false,scope:'Capture accounting only. No observed pairs, accuracy, adoption or registration are established.'};
}
