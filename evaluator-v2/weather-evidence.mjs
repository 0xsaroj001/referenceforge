// Offline canonical-answer audit against supplied NWS captures. No retrieval,
// source authentication, location geocoding, model, WASM or finality claim.
import {parseUniqueJson} from './strict-json.mjs';
import {decimal} from '../src/decimal.mjs';

const POLICY='nws_current_capture_v1',ORIGIN='https://api.weather.gov';
const issue=code=>{throw Object.assign(new Error(code),{code});};
const insist=(condition,code)=>{if(!condition)issue(code);};
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const scope='Canonical temperature only at a supplied NWS station near explicit coordinates. Supplied JSON/URLs do not prove source authenticity, exact-point weather or NWS coverage.';
const result=(outcome,reason,details={})=>({valid:outcome==='accept',outcome,policy:POLICY,...(outcome==='abstain'?{refusal:reason}:reason?{reasons:[reason]}:{reasons:[]}),source_authenticity_verified:false,...details,scope});

// Validate descriptors before reading values, including nested source payloads.
// Strings use the existing duplicate-key gate before becoming data objects.
function data(input,limit){
  let value=input;
  if(typeof value==='string'){
    insist(Buffer.byteLength(value,'utf8')<=limit,'INPUT_TOO_LARGE');
    try{value=parseUniqueJson(value);}catch(e){issue(e.code==='DUPLICATE_JSON_KEY'?'DUPLICATE_JSON_KEY':'INVALID_JSON');}
  }
  const seen=new Set();let count=0,bytes=0;
  function walk(v,depth){
    insist(depth<=16&&++count<=10000,'INPUT_LIMIT');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='string'){bytes+=Buffer.byteLength(v,'utf8');insist(bytes<=limit,'INPUT_TOO_LARGE');return;}
    if(typeof v==='number'){insist(Number.isFinite(v),'NONFINITE_DATA');return;}
    insist(v&&typeof v==='object','NON_JSON_DATA');
    insist(!seen.has(v),'CYCLIC_OR_SHARED_DATA');seen.add(v);
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
    insist(array?proto===Array.prototype:proto===null||proto===Object.prototype,'NON_PLAIN_DATA');
    const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
    for(const key of keys){
      if(array&&key==='length')continue;
      insist(typeof key==='string'&&!['__proto__','constructor','prototype'].includes(key),'UNSUPPORTED_DATA_KEY');
      const d=descriptors[key];insist(!d.get&&!d.set&&d.enumerable&&Object.hasOwn(d,'value'),'NON_DATA_PROPERTY');
      if(array)insist(/^(?:0|[1-9]\d*)$/.test(key)&&Number(key)<v.length,'NON_JSON_ARRAY');
      bytes+=Buffer.byteLength(key,'utf8');insist(bytes<=limit,'INPUT_TOO_LARGE');walk(d.value,depth+1);
    }
    if(array)insist(keys.length===v.length+1,'SPARSE_ARRAY');
  }
  walk(value,0);return value;
}
function fields(v,expected,code){insist(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===expected.length&&expected.every(k=>Object.hasOwn(v,k)),code);}
function timestamp(value,code){
  insist(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),code);
  const ms=Date.parse(value);insist(Number.isFinite(ms),code);
  // Date.parse normalizes February 30. Round trip the local calendar part too.
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value),parts=match.slice(1).map(Number);
  const calendar=new Date(0);calendar.setUTCFullYear(parts[0],parts[1]-1,parts[2]);calendar.setUTCHours(parts[3],parts[4],parts[5],0);
  insist(calendar.getUTCFullYear()===parts[0]&&calendar.getUTCMonth()+1===parts[1]&&calendar.getUTCDate()===parts[2]&&calendar.getUTCHours()===parts[3]&&calendar.getUTCMinutes()===parts[4]&&calendar.getUTCSeconds()===parts[5],code);
  return ms;
}
function point(geometry){
  insist(geometry?.type==='Point'&&Array.isArray(geometry.coordinates)&&[2,3].includes(geometry.coordinates.length),'INVALID_STATION_COORDINATES');
  const [lon,lat,alt]=geometry.coordinates;insist(finite(lon,-180,180)&&finite(lat,-90,90)&&(alt===undefined||finite(alt,-1000,10000)),'INVALID_STATION_COORDINATES');return {lat,lon};
}
function km(a,b){const rad=n=>n*Math.PI/180,q=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lon-a.lon)/2)**2;return 12742*Math.atan2(Math.sqrt(Math.min(1,q)),Math.sqrt(Math.max(0,1-q)));}
function sourceUrl(value,path){
  let url;try{url=new URL(value);}catch{issue('INVALID_SOURCE_URL');}
  insist(typeof value==='string'&&url.origin===ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname===path&&url.href===value,'SOURCE_NOT_ALLOWED');
}
function observationIdentity(value,stationId,observedAt){
  if(value===undefined)return;
  let url;try{url=new URL(value);}catch{issue('CONFLICTING_OBSERVATION_ID');}
  const prefix='/stations/'+stationId+'/observations/';
  insist(typeof value==='string'&&url.origin===ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.startsWith(prefix),'CONFLICTING_OBSERVATION_ID');
  let suffix;try{suffix=decodeURIComponent(url.pathname.slice(prefix.length));}catch{issue('CONFLICTING_OBSERVATION_ID');}
  insist(timestamp(suffix,'CONFLICTING_OBSERVATION_ID')===observedAt,'CONFLICTING_OBSERVATION_ID');
}
function temperature(q){
  insist(q&&typeof q==='object'&&finite(q.value,-1000,1000),'MISSING_OR_INVALID_TEMPERATURE');
  insist(q.qualityControl===undefined||['C','S','V','G'].includes(q.qualityControl),'REJECTED_TEMPERATURE_QUALITY');
  insist(['wmoUnit:degC','wmoUnit:degF'].includes(q.unitCode),'UNSUPPORTED_TEMPERATURE_UNIT');
  let {n,d}=decimal(q.value);
  if(q.unitCode==='wmoUnit:degF'){n=(n-32n*d)*5n;d*=9n;}
  insist(n>=-100n*d&&n<=70n*d,'OUT_OF_PHYSICAL_RANGE');
  // Exact rational conversion of the supplied number's decimal representation.
  // Round to 0.001 C, nearest with ties toward positive infinity. The existing
  // service uses binary floating-point conversion and Math.round, which can
  // disagree at decimal half boundaries. Those policy gaps abstain below.
  const scaled=n*1000n,offset=2n*scaled+d,divisor=2n*d;
  let rounded=offset/divisor;if(offset<0n&&offset%divisor!==0n)rounded--;
  insist(rounded>=-90000n&&rounded<=60000n,'OUTSIDE_CANONICAL_RANGE');
  const exact=Number(rounded)/1000;
  const serviceC=q.unitCode==='wmoUnit:degF'?(q.value-32)*5/9:q.value;
  const serviceRounded=Math.round(serviceC*1000)/1000;
  insist(exact===serviceRounded,'ROUNDING_POLICY_GAP');
  return exact;
}

export function checkWeatherAnswerWithEvidence(request,evidence,candidate){
  let expected,observedAt,distance,stationId;
  try{
    request=data(request,4096);evidence=data(evidence,1048576);
    fields(request,['location'],'UNSUPPORTED_REQUEST');
    const m=typeof request.location==='string'&&/^(-?(?:\d{1,3})(?:\.\d{1,4})?),(-?(?:\d{1,3})(?:\.\d{1,4})?)$/.exec(request.location);
    insist(m,'COORDINATE_REQUEST_REQUIRED');const wanted={lat:Number(m[1]),lon:Number(m[2])};insist(finite(wanted.lat,-90,90)&&finite(wanted.lon,-180,180),'INVALID_REQUEST_COORDINATES');
    fields(evidence,['captured_at','station','observation'],'INVALID_CAPTURE_ENVELOPE');
    const clock=timestamp(evidence.captured_at,'INVALID_CAPTURE_CLOCK');
    fields(evidence.station,['source_url','payload'],'INVALID_STATION_CAPTURE');fields(evidence.observation,['source_url','payload'],'INVALID_OBSERVATION_CAPTURE');
    const station=evidence.station.payload,observation=evidence.observation.payload;
    insist(station?.type==='Feature'&&station.properties&&typeof station.properties.stationIdentifier==='string','INVALID_STATION');stationId=station.properties.stationIdentifier;insist(/^[A-Z0-9]{3,8}$/.test(stationId),'INVALID_STATION_ID');
    sourceUrl(evidence.station.source_url,'/stations/'+stationId);sourceUrl(evidence.observation.source_url,'/stations/'+stationId+'/observations/latest');
    for(const id of [station.id,station.properties['@id']])if(id!==undefined)sourceUrl(id,'/stations/'+stationId);
    insist(observation?.type==='Feature'&&observation.properties?.station===ORIGIN+'/stations/'+stationId,'CONFLICTING_OBSERVATION_STATION');
    const stationPoint=point(station.geometry),observationPoint=point(observation.geometry);
    // NWS observations may round station coordinates to two decimals; allow at
    // most 1 km discrepancy while still using the catalogue point for distance.
    insist(km(stationPoint,observationPoint)<=1,'CONFLICTING_OBSERVATION_POINT');
    distance=km(wanted,stationPoint);insist(distance<=50,'STATION_TOO_FAR');
    observedAt=timestamp(observation.properties.timestamp,'INVALID_OBSERVATION_TIMESTAMP');
    observationIdentity(observation.id,stationId,observedAt);observationIdentity(observation.properties['@id'],stationId,observedAt);
    insist(clock-observedAt<=5400000,'STALE_OBSERVATION');insist(observedAt-clock<=300000,'FUTURE_OBSERVATION');
    expected=temperature(observation.properties.temperature);
  }catch(error){return result('abstain',error.code??'INVALID_CAPTURE');}
  let answer;
  try{answer=data(candidate,32768);fields(answer,['temperature_c'],'CANONICAL_ANSWER_ONLY');}
  catch(error){return result('reject',error.code??'INVALID_ANSWER');}
  if(!finite(answer.temperature_c,-90,60))return result('reject','INVALID_CANONICAL_TEMPERATURE');
  if(answer.temperature_c!==expected)return result('reject','TEMPERATURE_MISMATCH');
  return result('accept',null,{expected_temperature_c:expected,station_id:stationId,distance_km:Math.round(distance*1000)/1000,observed_at:new Date(observedAt).toISOString(),temperature_rounding:'0.001 C; exact nearest/ties toward positive infinity must also agree with current Provider float conversion and Math.round; policy gaps abstain',location_meaning:'Nearby station observation, not exact requested-point weather'});
}
