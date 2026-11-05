// Supporting direct-client workflow. No Engine request, wallet or payment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {boundedText} from '../../src/onchain/rpc.mjs';
const origin='https://referenceforge.0xsaroj001.workers.dev';
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export async function collectPlaceWeather({resolve,location,hours=24,fetchImpl=fetch,now=()=>new Date()}={}){
  assert(typeof resolve==='function');assert(Number.isInteger(hours)&&hours>=1&&hours<=48,'Window must be 1..48 hours');
  // Resolve before any network call: ambiguous names must never choose a source point.
  const place=resolve(location),report={checked_at:now().toISOString(),place,hours,pass:false,captures:[],telegraph_engine_requests:0,payments:0,scope:'Author-run direct weather client at a Census internal point, not independent app consumption, network routing, exact-city weather or forecast-skill evidence.'};
  async function read(path,params){
    const url=new URL(origin+path);for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
    const capture={url:url.href};report.captures.push(capture);const start=performance.now();
    try{
      const signal=AbortSignal.timeout(45000),r=await fetchImpl(url.href,{redirect:'error',signal});capture.status=r.status;
      const raw=await boundedText(r,2000000,signal);capture.payload_sha256=createHash('sha256').update(raw).digest('hex');
      try{capture.body=JSON.parse(raw);}catch{capture.raw=raw;throw Error('INVALID_PROVIDER_JSON');}
      assert.equal(r.status,200,'Provider refused '+path);return capture.body;
    }catch(error){capture.error=error.code??error.message;throw error;}finally{capture.elapsed_ms=Math.round(performance.now()-start);}
  }
  try{
    const current=await read('/v2/weather/current',{location:place.coordinates});
    assert(current.provider_status==='ok'&&current.intent==='WEATHER_CHECK_TEMPERATURE'&&current.request_schema_version===3&&current.response_format_version===1&&finite(current.temperature_c,-90,60),'Current-weather contract mismatch');
    assert(current.evidence?.verified_answer===true&&current.evidence?.fallback===false,'Current weather lacks verified-source status');
    const forecast=await read('/v2/weather/forecast',{location:place.coordinates,window_hours:hours});
    assert(forecast.provider_status==='ok'&&forecast.intent==='WEATHER_FORECAST_GENERAL'&&forecast.request_schema_version===3&&forecast.response_format_version===3,'Forecast contract mismatch');
    assert(finite(forecast.temp_min_c,-90,60)&&finite(forecast.temp_max_c,-90,60)&&forecast.temp_min_c<=forecast.temp_max_c&&finite(forecast.precipitation_probability_pct,0,100)&&typeof forecast.condition==='string'&&forecast.condition.length>0,'Forecast values invalid');
    assert(forecast.location===place.coordinates&&forecast.evidence?.verified_answer===true&&forecast.evidence?.fallback===false&&forecast.evidence?.window?.hours===hours,'Forecast point/window or source status differs');
    report.summary={current_temperature_c:current.temperature_c,forecast_min_c:forecast.temp_min_c,forecast_max_c:forecast.temp_max_c,max_hourly_precipitation_probability_pct:forecast.precipitation_probability_pct,conditions:forecast.condition,window:forecast.when,location:place.official_name+', '+place.state,coordinates:place.coordinates};report.pass=true;
  }catch(error){report.failure=error.code??error.message;}
  return report;
}
