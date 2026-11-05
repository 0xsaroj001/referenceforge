// Original offline consumer demonstration. Not a new miner intent or safety system.
const HOUR=3600000,MINUTE=60000;
const INTENTS=['WEATHER_FORECAST','WEATHER_CHECK','STORM_ALERT'];
const scope='Illustrative planning thresholds only. Matching a window is not an all-clear or permission to operate. Issued alerts describe the checked feed, not future unissued warnings. This is our own offline consumer demonstration, not independent adoption or a Telegraph receipt.';
class PlanError extends Error{constructor(state,message){super(message);this.state=state;}}
const insist=(condition,message)=>{if(!condition)throw new PlanError('insufficient_data',message);};
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
function provenance(answer,now){
  insist(Array.isArray(answer.sources)&&answer.sources.length>=2&&answer.sources.length<=6,'Source records are missing or incomplete.');
  for(const s of answer.sources){let u;try{u=new URL(s.source_url);}catch{insist(false,'Source URL is invalid.');}
    insist(u.origin==='https://api.weather.gov'&&!u.username&&!u.password&&!u.hash&&/^[a-f0-9]{64}$/.test(s.payload_sha256),'Source identity or hash is invalid.');
    const age=now-time(s.fetched_at),limit=/\/alerts$/.test(u.pathname)?5*MINUTE:/\/observations\/latest$/.test(u.pathname)?5*MINUTE:/\/forecast\/hourly$/.test(u.pathname)?15*MINUTE:24*HOUR;
    insist(Number.isFinite(age)&&age>=-5*MINUTE&&age<=limit,'A required source capture is stale or has an invalid timestamp.');
  }
}
export function planWeatherWindows(answers,options={}){
  const base={workflow:'alternative_weather_windows',human_review_required:true,all_clear:false,scope};
  try{
    if(!options||Array.isArray(options)||typeof options!=='object'||Object.keys(options).some(k=>!['duration_hours','wind_below_kmh','precip_probability_below_pct','temperature_min_c','temperature_max_c','max_results','now'].includes(k)))throw new PlanError('invalid_request','Unsupported planner setting.');
    const {duration_hours=3,wind_below_kmh=30,precip_probability_below_pct=60,temperature_min_c=-10,temperature_max_c=40,max_results=3,now=new Date()}=options;
    if(!Number.isInteger(duration_hours)||duration_hours<1||duration_hours>24||!Number.isInteger(max_results)||max_results<1||max_results>5||!finite(wind_below_kmh,0,500)||!finite(precip_probability_below_pct,0,100)||!finite(temperature_min_c,-100,70)||!finite(temperature_max_c,-100,70)||temperature_min_c>temperature_max_c||!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new PlanError('invalid_request','Use a duration of 1–24 hours and valid explicit thresholds, result count and clock.');
    const clock=now.getTime();
    insist(Array.isArray(answers)&&answers.length===3&&INTENTS.every(i=>answers.filter(a=>a?.intent===i).length===1),'Exactly one answer from each of the three weather capabilities is required.');
    for(const a of answers){insist(a.status==='ok'&&a.verified_answer===true&&a.fallback===false,'A weather answer is unavailable or unverified.');provenance(a,clock);}
    const f=answers.find(a=>a.intent===INTENTS[0]),o=answers.find(a=>a.intent===INTENTS[1]),a=answers.find(a=>a.intent===INTENTS[2]);
    const lat=f.location?.latitude,lon=f.location?.longitude;
    insist(finite(lat,-90,90)&&finite(lon,-180,180)&&answers.every(x=>x.location?.latitude===lat&&x.location?.longitude===lon),'Weather answer locations do not match.');
    insist(f.data_kind==='official_hourly_forecast'&&o.data_kind==='station_observation'&&a.data_kind==='issued_official_alerts','Forecasts, station observations and official alerts cannot substitute for each other.');
    const issue=time(f.source_updated_at),generated=time(f.response_generated_at);
    insist(Number.isFinite(issue)&&clock-issue>=-5*MINUTE&&clock-issue<=24*HOUR&&Number.isFinite(generated)&&clock-generated>=-5*MINUTE&&clock-generated<=2*HOUR,'Forecast issue or generation time is stale or invalid.');
    const observed=time(o.observed_at);
    insist(Number.isFinite(observed)&&clock-observed>=-5*MINUTE&&clock-observed<=90*MINUTE&&finite(o.station?.distance_km,0,50)&&/^[A-Z0-9]{3,8}$/.test(o.station?.id??'')&&finite(o.metrics?.temperature,-100,70),'A fresh nearby station observation is required.');
    insist(['C','S','V','G'].includes(o.observation_quality?.temperature),'Observation temperature needs a supplied accepted quality flag.');
    const start=time(f.window?.start_time),end=time(f.window?.end_time),hours=f.window?.hours;
    insist(Number.isInteger(hours)&&hours>=duration_hours&&hours<=48&&Array.isArray(f.hourly)&&f.hourly.length===hours&&Number.isFinite(start)&&start%HOUR===0&&end-start===hours*HOUR,'Forecast window is incomplete, shifted or too short.');
    insist(f.probability_complete===true,'Every candidate hour needs an actual precipitation probability; missing is not zero.');
    for(let i=0;i<hours;i++){const h=f.hourly[i];insist(h&&time(h.start_time)===start+i*HOUR&&time(h.end_time)===start+(i+1)*HOUR&&finite(h.temperature_c,-100,70)&&finite(h.precipitation_probability_pct,0,100)&&finite(h.wind_speed_kmh?.min,0,650)&&finite(h.wind_speed_kmh?.max,h.wind_speed_kmh?.min,650),'Forecast hours must be contiguous with explicit temperatures, probabilities and wind ranges.');}
    const checked=time(a.checked_at),alertEnd=time(a.window_end);
    insist(Number.isFinite(checked)&&clock-checked>=-5*MINUTE&&clock-checked<=5*MINUTE&&Number.isFinite(alertEnd)&&alertEnd>clock&&alertEnd-checked<=24*HOUR+MINUTE&&a.all_clear===false&&Array.isArray(a.alerts)&&a.alerts.length<500&&Number.isInteger(a.alert_count)&&a.alert_count===a.alerts.length,'A fresh, bounded official alert feed is required.');
    // Message expiry is not proof that a hazard with a later stated end has ended.
    const alerts=a.alerts.map(x=>{const begin=time(x?.onset),expires=time(x?.expires),ends=x?.ends===null||x?.ends===undefined?expires:time(x.ends),until=Math.max(expires,ends);insist(x&&typeof x.id==='string'&&typeof x.event==='string'&&Number.isFinite(begin)&&Number.isFinite(expires)&&Number.isFinite(ends)&&until>begin&&until>clock,'An issued alert has an invalid or expired validity interval.');return {...x,begin,until};});
    insist(new Set(alerts.map(x=>x.id)).size===alerts.length,'Duplicate alert identities make coverage ambiguous.');
    const candidates=[],excluded={past_start:0,outside_alert_coverage:0,issued_alert:0,wind_threshold:0,precipitation_threshold:0,temperature_threshold:0};let covered=0;
    for(let i=0;i<=hours-duration_hours;i++){
      const begin=start+i*HOUR,until=begin+duration_hours*HOUR;
      if(begin<clock){excluded.past_start++;continue;}
      if(begin<checked||until>alertEnd){excluded.outside_alert_coverage++;continue;}covered++;
      const slice=f.hourly.slice(i,i+duration_hours),wind=Math.max(...slice.map(h=>h.wind_speed_kmh.max)),precip=Math.max(...slice.map(h=>h.precipitation_probability_pct)),low=Math.min(...slice.map(h=>h.temperature_c)),high=Math.max(...slice.map(h=>h.temperature_c));
      let rejected=false;
      if(alerts.some(x=>x.begin<until&&x.until>begin)){excluded.issued_alert++;rejected=true;}
      if(wind>=wind_below_kmh){excluded.wind_threshold++;rejected=true;}
      if(precip>=precip_probability_below_pct){excluded.precipitation_threshold++;rejected=true;}
      if(low<temperature_min_c||high>temperature_max_c){excluded.temperature_threshold++;rejected=true;}
      if(!rejected)candidates.push({start_time:new Date(begin).toISOString(),end_time:new Date(until).toISOString(),hours:duration_hours,temperature_min_c:low,temperature_max_c:high,wind_speed_max_kmh:wind,max_hourly_precipitation_probability_pct:precip});
    }
    // Greedy non-overlapping alternatives, not a global scheduling optimum.
    candidates.sort((x,y)=>x.max_hourly_precipitation_probability_pct-y.max_hourly_precipitation_probability_pct||x.wind_speed_max_kmh-y.wind_speed_max_kmh||time(x.start_time)-time(y.start_time));
    const windows=[];for(const c of candidates)if(windows.length<max_results&&!windows.some(w=>time(w.start_time)<time(c.end_time)&&time(w.end_time)>time(c.start_time)))windows.push(c);
    return {...base,state:covered===0?'insufficient_data':windows.length?'alternatives_available':'no_window_meets_thresholds',evaluated_at:now.toISOString(),location:{...f.location},thresholds:{duration_hours,wind_below_kmh,precip_probability_below_pct,temperature_min_c,temperature_max_c},selection:'Lowest maximum hourly precipitation probability, then lowest maximum wind, then earliest UTC start; greedy non-overlapping windows.',probability_interpretation:'Maximum individual hourly probability, not a probability for the whole work window.',forecast_window:{...f.window},eligible_candidate_count:candidates.length,covered_candidate_count:covered,excluded_candidates:excluded,windows,reasons:covered===0?['No complete future candidate lies within the checked alert horizon.']:windows.length?['These alternatives meet the supplied illustrative thresholds; review official instructions and recheck before use.']:['No fully covered window meets every supplied threshold.'],current_station:{...o.station},current_observed_at:o.observed_at,forecast_issued_at:f.source_updated_at,forecast_generated_at:f.response_generated_at,alerts_checked_at:a.checked_at,alerts_window_end:a.window_end,official_instructions:alerts.map(({begin,until,...x})=>x),evidence:answers.map(x=>({intent:x.intent,sources:x.sources.map(s=>({...s}))}))};
  }catch(e){if(!(e instanceof PlanError))throw e;return {...base,state:e.state,windows:[],reasons:[e.message]};}
}
