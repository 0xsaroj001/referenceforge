import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWeather} from '../src/weather.mjs';
import {createUnifiedHandler} from '../src/unified.mjs';
const directory='reports/weather/',captures=[],rows=[],cache=new Map();
await mkdir(directory,{recursive:true});
const fetchImpl=async(url,options)=>{const r=await fetch(url,options);const text=await r.text();assert(text.length<1000000);captures.push({url,status:r.status,text});return new Response(text,{status:r.status,headers:r.headers});};
const handler=createUnifiedHandler({weather:true,expanded:true,weatherMiner:createWeather({fetchImpl,cache})});
for(const city of [{name:'Miami',lat:25.7617,lon:-80.1918},{name:'New York',lat:40.7128,lon:-74.006},{name:'Kansas',lat:39.7456,lon:-97.0892}]){
  for(const kind of ['forecast','current','alerts']){
    const path='/weather/'+kind+'?'+new URLSearchParams({lat:city.lat,lon:city.lon,...(kind==='forecast'?{hours:24}:{})}),start=performance.now();
    const r=await handler(new Request('https://local.test'+path)),answer=await r.json();
    rows.push({city:city.name,kind,path,status:r.status,pass:r.status===200&&answer.verified_answer===true,latency_ms:Math.round(performance.now()-start),answer});
  }
}
const report={checked_at:new Date().toISOString(),total:rows.length,passed:rows.filter(x=>x.pass).length,source_captures:captures.length,rows,scope:'Local handler, real NWS sources. Tests source conformance and availability, not forecast skill, Telegraph routing, quality score, customer adoption or earnings.'};
const filename='live-local-'+Date.now()+'.json';await writeFile(directory+filename,JSON.stringify(report,null,2)+'\n');
await writeFile(directory+'latest-live.json',JSON.stringify({report:filename,captures:'captures-'+filename},null,2));await writeFile(directory+'captures-'+filename,JSON.stringify(captures,null,2));
console.log(JSON.stringify({...report,rows:rows.map(({answer,...r})=>({...r,error_code:answer.error?.code,age_seconds:answer.age_seconds,station:answer.station?.id,alerts:answer.alert_count}))},null,2));if(report.passed!==report.total)process.exitCode=1;
