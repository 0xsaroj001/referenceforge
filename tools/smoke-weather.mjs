import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {UNIFIED_ORIGIN} from './render-weather-miner.mjs';
const origin=process.argv[2]??'http://127.0.0.1:8794';assert(['http://127.0.0.1:8794',UNIFIED_ORIGIN].includes(origin));
const p=JSON.parse(await readFile('reports/weather/prepared.json','utf8')),rows=[],answers=[];
async function check(id,path,status,verify,options={}){const start=performance.now();let actual,error_code;
  try{const r=await fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(20000)}),bytes=Buffer.from(await r.arrayBuffer());actual=r.status;assert(bytes.length<1000000);let a;try{a=JSON.parse(bytes);}catch{}error_code=a?.error?.code;assert.equal(actual,status);await verify?.(a,bytes);rows.push({id,pass:true,status:actual,latency_ms:Math.round(performance.now()-start)});if(id.startsWith('live-'))answers.push({id,path,answer:a});}
  catch(e){rows.push({id,pass:false,status:actual,error_code,error:e.message.slice(0,300)});}
}
for(const asset of [...p.preserved,p.output,...(p.candidate_outputs??[])])await check('bytes-'+asset.file,'/'+asset.file,200,(_,b)=>assert.equal('0x'+createHash('sha256').update(b).digest('hex'),asset.sha256));
await check('health-ten','/health',200,a=>{assert(['0.5.0','0.5.1'].includes(a.version));assert.equal(a.supported_intents.length,10);assert.match(a.weather_coverage,/US/);});
for(const path of ['/research/','/reports/weather/','/tools/upgrade-weather-miner.mjs','/.env','/__weather-cache'])await check('private-'+path,path,404);
for(const kind of ['forecast','current','alerts']){
  await check('missing-'+kind,'/weather/'+kind,422,a=>assert.equal(Object.hasOwn(a,'score_value'),false));
  await check('duplicate-'+kind,'/weather/'+kind+'?lat=1&lat=2&lon=3',400);
}
await check('reject-window','/weather/forecast?lat=25.7617&lon=-80.1918&hours=49',422);
await check('reject-arbitrary-upstream','/weather/alerts?lat=25.7617&lon=-80.1918&source_url=https://example.com',422);
await check('outside-coverage','/weather/alerts?lat=28.6139&lon=77.209',422,a=>assert.equal(a.error.code,'UNSUPPORTED_LOCATION'));
for(const c of [{name:'Miami',lat:25.7617,lon:-80.1918},{name:'New-York',lat:40.7128,lon:-74.006},{name:'Kansas',lat:39.7456,lon:-97.0892}]){
  for(const kind of ['forecast','current','alerts'])await check('live-'+c.name+'-'+kind,'/weather/'+kind+'?'+new URLSearchParams({lat:c.lat,lon:c.lon}),200,a=>{
    assert.equal(a.verified_answer,true);assert.equal(typeof a.score_value,'string');assert(a.sources.length>=2);assert(a.sources.every(s=>/^[a-f0-9]{64}$/.test(s.payload_sha256)));assert(a.source_http_requests<=6);
    if(kind==='forecast'){assert.equal(a.hourly.length,24);assert.equal(Date.parse(a.window.end_time)-Date.parse(a.window.start_time),86400000);assert(a.forecast_issue_age_hours<=24);assert(a.hourly.every((h,i)=>Date.parse(h.start_time)===Date.parse(a.window.start_time)+i*3600000));}
    if(kind==='current'){assert.equal(a.data_kind,'station_observation');assert(a.age_seconds<=5400);assert(a.station.distance_km<=50);}
    if(kind==='alerts'){assert.equal(a.all_clear,false);assert(a.alerts.every(x=>Date.parse(x.expires)>Date.now()));}
  });
}
await check('live-metric-post','/weather/forecast',200,a=>{assert.equal(a.score_value,String(a.metrics.temperature_max));},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:25.7617,lon:-80.1918,hours:6,metric:'temperature_max'})});
const report={checked_at:new Date().toISOString(),origin,total:rows.length,passed:rows.filter(x=>x.pass).length,rows,answers,scope:'Direct HTTP source-conformance and privacy checks; no Telegraph-routed score, future forecast skill or production uptime claim.'};const file='reports/weather/'+(origin===UNIFIED_ORIGIN?'public':'workerd')+'-smoke-'+Date.now()+'.json';await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,answers:undefined},null,2));if(report.passed!==report.total)process.exitCode=1;
