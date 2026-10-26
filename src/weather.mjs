import { createHash } from 'node:crypto';
import { ServiceError } from './errors.mjs';
import { boundedText } from './onchain/rpc.mjs';

export const WEATHER_INTENTS = Object.freeze(['WEATHER_FORECAST','WEATHER_CHECK','STORM_ALERT']);
export const WEATHER_PATHS = Object.freeze(['/weather/forecast','/weather/current','/weather/alerts']);
const ORIGIN='https://api.weather.gov';
const UA='ReferenceForge/0.5 (https://github.com/0xsaroj001/referenceforge)';
const error=(code,message,status=422)=>{throw new ServiceError(code,message,status);};
const insist=(ok,code,message,status=503)=>{if(!ok)error(code,message,status);};
const finite=(v,min=-Infinity,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const round=v=>Math.round(v*1000)/1000;
const sha=s=>createHash('sha256').update(s).digest('hex');
function input(p,kind){
  const allowed=['lat','lon','metric',...(kind==='forecast'?['hours','start_time']:[])];
  if(!p||Object.keys(p).some(k=>!allowed.includes(k)))error('UNSUPPORTED_PARAMETER','Use only the documented weather parameters; no free-form question, source URL, city-name guess or API key.');
  const number=(value,min,max)=>typeof value==='number'?finite(value,min,max):typeof value==='string'&&/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)&&finite(Number(value),min,max);
  if(!number(p.lat,-90,90)||!number(p.lon,-180,180))error('INVALID_COORDINATES','Supply lat -90..90 and lon -180..180 in decimal degrees.');
  // Four decimals bound precision and avoid unbounded source cache variants.
  const lat=Number(Number(p.lat).toFixed(4)),lon=Number(Number(p.lon).toFixed(4));
  const metrics=kind==='forecast'?['summary','temperature_min','temperature_max','wind_speed_max','precipitation_probability_max']:kind==='current'?['summary','temperature','wind_speed','humidity']:['summary','alert_count','max_severity'];
  const metric=p.metric??'summary';if(!metrics.includes(metric))error('UNSUPPORTED_METRIC','Supported metrics: '+metrics.join(', '));
  let hours;
  if(kind==='forecast'){hours=String(p.hours??24);if(!/^[1-9]\d?$/.test(hours)||Number(hours)>48)error('INVALID_WINDOW','hours must be an integer from 1 to 48.');}
  if(p.start_time!==undefined&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(p.start_time)||!stamp(p.start_time)||new Date(Date.parse(p.start_time)).toISOString()!==p.start_time.replace('Z','.000Z')))error('INVALID_WINDOW','start_time must be an exact future UTC hour YYYY-MM-DDTHH:00:00Z.');
  return {lat,lon,metric,...(hours?{hours:Number(hours)}:{}),...(p.start_time?{start_time:p.start_time}:{})};
}
function reference(url,pattern){const u=new URL(url,ORIGIN);insist(u.origin===ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&pattern.test(u.pathname),'INVALID_SOURCE','NWS supplied an unexpected linked resource.');return u.href;}
function distance(lat,lon,geometry){
  const c=geometry?.coordinates;if(geometry?.type!=='Point'||!Array.isArray(c)||!finite(c[0],-180,180)||!finite(c[1],-90,90))return Infinity;
  const rad=d=>d*Math.PI/180,a=Math.sin(rad(c[1]-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(c[1]))*Math.sin(rad(c[0]-lon)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a)));
}
export function windRange(value){
  if(value==='Calm')return {min:0,max:0};
  const m=typeof value==='string'&&/^(\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))? (mph|km\/h|kph|m\/s|kt)$/.exec(value);
  insist(m,'INVALID_SOURCE','NWS forecast wind units or range are unsupported.');
  const k={'mph':1.609344,'km/h':1,kph:1,'m/s':3.6,kt:1.852}[m[3]],lo=Number(m[1]),hi=Number(m[2]??m[1]);
  insist(hi>=lo&&hi<=400,'INVALID_SOURCE','Invalid forecast wind range.');return {min:round(lo*k),max:round(hi*k)};
}
function quantity(q,kind){
  if(q?.value===null||q?.value===undefined)return null;
  insist(finite(q.value)&&!['Z','X','Q'].includes(q.qualityControl),'INVALID_SOURCE','Observation contains invalid or rejected-quality data.');
  const units={temperature:{'wmoUnit:degC':v=>v,'wmoUnit:degF':v=>(v-32)*5/9},wind:{'wmoUnit:km_h-1':v=>v,'wmoUnit:m_s-1':v=>v*3.6,'wmoUnit:mi_h-1':v=>v*1.609344},humidity:{'wmoUnit:percent':v=>v}};
  const convert=units[kind][q.unitCode];insist(convert,'INVALID_SOURCE','Unsupported observation unit.');
  const v=convert(q.value);insist(kind==='temperature'?finite(v,-100,70):kind==='humidity'?finite(v,0,100):finite(v,0,500),'INVALID_SOURCE','Observation is outside physical bounds.');return round(v);
}

export function createWeather({fetchImpl=fetch,now=()=>new Date(),cache=new Map(),cacheApi,timeoutMs=10000}={}){
  async function run(kind,params,{signal}={}){
    const p=input(params,kind),started=now().getTime(),deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)]),sources=[];
    const firstHour=Math.ceil(started/3600000)*3600000;
    if(kind==='forecast'&&p.start_time&&(Date.parse(p.start_time)<firstHour||Date.parse(p.start_time)>firstHour+48*3600000))error('UNSUPPORTED_WINDOW','Forecast must start at a future UTC hour within 48 hours.');
    let calls=0;
    async function get(url,ttl,validate){
      const parsed=new URL(url);insist(parsed.origin===ORIGIN&&!parsed.username&&!parsed.password&&/^\/(points\/|gridpoints\/|stations\/|alerts$)/.test(parsed.pathname),'SOURCE_NOT_ALLOWED','Only bounded official NWS resources are allowed.');
      const key=new Request('https://referenceforge.0xsaroj001.workers.dev/__weather-cache?source='+encodeURIComponent(url));
      let entry=cache.get(url),hit=false;
      if(!entry&&cacheApi){try{const r=await cacheApi.match(key);if(r)entry=JSON.parse(await boundedText(r,1100000,deadline));}catch{}}
      if(entry?.expires>now().getTime()){
        try{const data=JSON.parse(entry.text);validate(data);hit=true;}catch{entry=null;cache.delete(url);}
      }else entry=null;
      if(!entry){
        insist(++calls<=6,'SOURCE_BUDGET','Weather source request budget exceeded.');
        let r,text;
        try{r=await fetchImpl(url,{redirect:'manual',headers:{'User-Agent':UA,Accept:'application/geo+json'},signal:deadline});
          if(r.status===404&&parsed.pathname.startsWith('/points/'))error('UNSUPPORTED_LOCATION','This coordinate is outside supported NWS point coverage.',422);
          insist(r.status===200,'WEATHER_SOURCE_UNAVAILABLE','NWS source unavailable; no forecast substitute or all-clear fallback.');
          text=await boundedText(r,1000000,deadline);
        }catch(e){if(e instanceof ServiceError)throw e;error('WEATHER_SOURCE_UNAVAILABLE','NWS timed out or could not be read within bounds.',503);}
        let data;try{data=JSON.parse(text);}catch{error('INVALID_SOURCE','NWS response is not valid JSON.',503);}validate(data);
        const date=r.headers.get('date');insist(!date||stamp(date)&&Math.abs(now().getTime()-Date.parse(date))<=600000,'STALE_SOURCE','NWS HTTP response is stale or future-dated.');
        const age=Number(r.headers.get('age')??0);insist(Number.isFinite(age)&&age>=0,'INVALID_SOURCE','Invalid upstream Age.');
        const maxAge=/\bmax-age=(\d+)/i.exec(r.headers.get('cache-control')??'');
        const lifetime=/\bno-(?:store|cache)\b/i.test(r.headers.get('cache-control')??'')?0:Math.max(0,Math.min(ttl,maxAge?Number(maxAge[1])-age:ttl));
        entry={text,fetched_at:now().toISOString(),expires:now().getTime()+lifetime*1000,source_url:url,payload_sha256:sha(text)};
        if(lifetime>0){if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(url,entry);if(cacheApi)try{await cacheApi.put(key,Response.json(entry,{headers:{'cache-control':'public, max-age='+Math.floor(lifetime)}}));}catch{}}
      }
      // Re-run freshness/schema validation even for validated cached source bytes.
      const data=JSON.parse(entry.text);validate(data);sources.push({source_url:url,payload_sha256:entry.payload_sha256,fetched_at:entry.fetched_at,cache_hit:hit});return data;
    }
    const point=await get(ORIGIN+`/points/${p.lat},${p.lon}`,21600,d=>insist(d?.type==='Feature'&&d.properties?.timeZone&&d.properties?.forecastHourly&&d.properties?.observationStations,'INVALID_SOURCE','Invalid NWS point response.'));
    const location={latitude:p.lat,longitude:p.lon,time_zone:point.properties.timeZone,coverage:'NWS-covered US land point; not global'};
    let body;
    if(kind==='forecast'){
      const start=p.start_time?Date.parse(p.start_time):firstHour,end=start+p.hours*3600000;
      if(start<firstHour||start>firstHour+48*3600000)error('UNSUPPORTED_WINDOW','Forecast must start at a future UTC hour within 48 hours.');
      const url=reference(point.properties.forecastHourly,/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/);
      const d=await get(url,300,d=>insist(Array.isArray(d?.properties?.periods)&&stamp(d.properties.updateTime)&&stamp(d.properties.generatedAt)&&started-Date.parse(d.properties.updateTime)<=86400000&&started-Date.parse(d.properties.generatedAt)<=7200000&&Date.parse(d.properties.updateTime)<=started+300000&&Date.parse(d.properties.generatedAt)<=started+300000,'STALE_FORECAST','NWS forecast issue is older than 24 hours, response generation is older than two hours, or timestamps are invalid.'));
      const selected=d.properties.periods.filter(x=>stamp(x.startTime)&&Date.parse(x.startTime)>=start&&Date.parse(x.startTime)<end).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
      insist(selected.length===p.hours&&selected.every((x,i)=>Date.parse(x.startTime)===start+i*3600000&&Date.parse(x.endTime)===start+(i+1)*3600000),'INCOMPLETE_FORECAST','Source does not cover every complete requested hour.');
      const hourly=selected.map(x=>{
        insist(finite(x.temperature,-150,160)&&['F','C'].includes(x.temperatureUnit)&&typeof x.shortForecast==='string','INVALID_SOURCE','Incomplete hourly temperature or conditions.');
        const t=x.temperatureUnit==='F'?(x.temperature-32)*5/9:x.temperature,w=windRange(x.windSpeed),q=x.probabilityOfPrecipitation;
        insist(finite(t,-100,70)&&q&&(q.value===null||q.unitCode==='wmoUnit:percent'&&finite(q.value,0,100)),'INVALID_SOURCE','Invalid forecast temperature/probability.');
        return {start_time:new Date(Date.parse(x.startTime)).toISOString(),end_time:new Date(Date.parse(x.endTime)).toISOString(),temperature_c:round(t),precipitation_probability_pct:q.value,wind_speed_kmh:w,wind_direction:x.windDirection??null,conditions:x.shortForecast};
      });
      const probabilities=hourly.map(x=>x.precipitation_probability_pct),complete=probabilities.every(x=>x!==null),metrics={temperature_min:Math.min(...hourly.map(x=>x.temperature_c)),temperature_max:Math.max(...hourly.map(x=>x.temperature_c)),wind_speed_max:Math.max(...hourly.map(x=>x.wind_speed_kmh.max)),precipitation_probability_max:complete?Math.max(...probabilities):null};
      if(p.metric!=='summary'&&metrics[p.metric]===null)error('MISSING_WEATHER_FIELD','Requested probability is unavailable for at least one hour.',503);
      const summary=`NWS forecast at ${p.lat},${p.lon}, ${new Date(start).toISOString()} to ${new Date(end).toISOString()}: temperature ${metrics.temperature_min} to ${metrics.temperature_max} C; maximum forecast wind ${metrics.wind_speed_max} km/h; maximum hourly precipitation probability ${complete?metrics.precipitation_probability_max+'%':'unavailable for the complete window'}. Model forecast, not an observation; source updated ${d.properties.updateTime}.`;
      body={intent:'WEATHER_FORECAST',data_kind:'official_hourly_forecast',window:{start_time:new Date(start).toISOString(),end_time:new Date(end).toISOString(),hours:p.hours},source_updated_at:d.properties.updateTime,response_generated_at:d.properties.generatedAt,forecast_issue_age_hours:round(Math.max(0,(started-Date.parse(d.properties.updateTime))/3600000)),hourly,metrics,probability_complete:complete,score_value:p.metric==='summary'?summary:String(metrics[p.metric]),summary};
    }else if(kind==='current'){
      const url=reference(point.properties.observationStations,/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/stations$/);
      const stations=await get(url,3600,d=>insist(d?.type==='FeatureCollection'&&Array.isArray(d.features),'INVALID_SOURCE','Invalid station catalogue.'));
      const near=stations.features.map(s=>({s,km:distance(p.lat,p.lon,s.geometry)})).filter(x=>x.km<=50).sort((a,b)=>a.km-b.km).slice(0,3);
      insist(near.length>0,'NO_NEARBY_STATION','No supported station within 50 km.');let chosen;
      for(const candidate of near){
        const id=candidate.s.properties?.stationIdentifier;insist(typeof id==='string'&&/^[A-Z0-9]{3,8}$/.test(id),'INVALID_SOURCE','Invalid station identifier.');
        const obs=await get(ORIGIN+`/stations/${id}/observations/latest`,60,d=>insist(d?.type==='Feature'&&d.properties&&stamp(d.properties.timestamp)&&d.properties.station===ORIGIN+'/stations/'+id,'INVALID_SOURCE','Invalid observation identity/timestamp.'));
        const o=obs.properties,age=(started-Date.parse(o.timestamp))/1000;if(age>5400||age< -300||o.temperature?.value===null)continue;
        const values={temperature:quantity(o.temperature,'temperature'),wind_speed:quantity(o.windSpeed,'wind'),humidity:quantity(o.relativeHumidity,'humidity')};
        if(values.temperature===null||p.metric!=='summary'&&values[p.metric]===null)continue;
        chosen={observation:o,values,station:{id,name:candidate.s.properties.name,distance_km:round(candidate.km),coordinates:candidate.s.geometry.coordinates},age_seconds:Math.max(0,Math.round(age))};break;
      }
      insist(chosen,'NO_FRESH_OBSERVATION','No complete requested observation <=90 minutes old among the nearest three stations within 50 km.');
      const {observation:o,values,station,age_seconds}=chosen;
      const summary=`NWS station ${station.id}, ${station.distance_km} km from ${p.lat},${p.lon}, observed ${o.timestamp}: ${values.temperature} C; wind ${values.wind_speed===null?'unavailable':values.wind_speed+' km/h'}; humidity ${values.humidity===null?'unavailable':values.humidity+'%'}. ${o.textDescription??''} Station observation, not a measurement at the exact requested point.`;
      body={intent:'WEATHER_CHECK',data_kind:'station_observation',observed_at:o.timestamp,age_seconds,station,metrics:values,units:{temperature:'C',wind_speed:'km/h',humidity:'percent'},conditions:o.textDescription??null,score_value:p.metric==='summary'?summary:String(values[p.metric]),summary};
    }else{
      const d=await get(ORIGIN+`/alerts?active=true&point=${p.lat},${p.lon}&status=actual`,30,d=>insist(d?.type==='FeatureCollection'&&Array.isArray(d.features)&&d.features.length<500&&!d.pagination?.next,'INCOMPLETE_ALERTS','NWS alert response is incomplete or paginated.'));
      const hazard=/tornado|thunderstorm|hurricane|tropical|storm|wind|blizzard|snow|ice|freez|flood|gale|squall|tsunami/i,alerts=[];const seen=new Set();
      for(const f of d.features){const a=f?.properties;insist(a&&typeof a.event==='string'&&typeof a.id==='string'&&stamp(a.expires),'INVALID_SOURCE','Malformed NWS alert; cannot issue an all-clear.');
        if(a.status!=='Actual'||!['Alert','Update'].includes(a.messageType)||!hazard.test(a.event))continue;
        insist(stamp(a.onset??a.effective)&&(!a.ends||stamp(a.ends)),'INVALID_SOURCE','Alert has an invalid validity window.');
        const onset=Date.parse(a.onset??a.effective),until=Math.min(Date.parse(a.expires),a.ends?Date.parse(a.ends):Infinity);
        if(until<=started||onset>=started+86400000||seen.has(a.id))continue;seen.add(a.id);
        alerts.push({id:a.id,event:a.event,severity:a.severity??'Unknown',certainty:a.certainty??'Unknown',urgency:a.urgency??'Unknown',onset:a.onset??a.effective,ends:a.ends??null,expires:a.expires,headline:a.headline??null,description:a.description??null,instruction:a.instruction??null,area_description:a.areaDesc??null,official_url:typeof a['@id']==='string'&&a['@id'].startsWith(ORIGIN+'/alerts/')?a['@id']:ORIGIN+'/alerts/'+encodeURIComponent(a.id)});
      }
      const severity={Extreme:4,Severe:3,Moderate:2,Minor:1,Unknown:0};alerts.sort((a,b)=>(severity[b.severity]??0)-(severity[a.severity]??0)||a.id.localeCompare(b.id));
      const max=alerts.length?Math.max(...alerts.map(x=>severity[x.severity]??0)):0;
      const summary=alerts.length?`${alerts.length} issued NWS storm/wind/flood/winter alerts overlap the next 24 hours at ${p.lat},${p.lon}: ${alerts.map(a=>a.event+' ('+a.severity+', expires '+a.expires+')').join('; ')}. Follow the official instructions provided. This is issued-warning coverage, not all possible severe-weather risk.`:`No matching issued NWS storm/wind/flood/winter alerts returned at ${p.lat},${p.lon} for now through the next 24 hours. This does not mean no storm or disruption risk, and does not predict future unissued warnings.`;
      body={intent:'STORM_ALERT',data_kind:'issued_official_alerts',checked_at:now().toISOString(),window_end:new Date(started+86400000).toISOString(),alert_count:alerts.length,max_severity:max,severity_scale:severity,has_issued_alert:alerts.length>0,all_clear:false,alerts,score_value:p.metric==='summary'?summary:String(p.metric==='alert_count'?alerts.length:max),summary};
    }
    return {status:'ok',mode:'reference',fallback:false,verified_answer:true,provider:'ReferenceForge',location,...body,attribution:{name:'NOAA National Weather Service',url:'https://www.weather.gov/documentation/services-web-api',notice:'NWS public information, normalized and filtered by ReferenceForge. No NWS endorsement or guaranteed delivery.'},sources,source_http_requests:calls};
  }
  return {forecast:(p,o)=>run('forecast',p,o),current:(p,o)=>run('current',p,o),alerts:(p,o)=>run('alerts',p,o)};
}
