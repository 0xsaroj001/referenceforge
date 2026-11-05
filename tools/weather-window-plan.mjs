import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createWeather} from '../src/weather.mjs';
import {boundedText} from '../src/onchain/rpc.mjs';
import {planWeatherWindows} from '../src/weather-window-planner.mjs';
export async function collectPlannerInputs({fetchImpl=fetch,lat=25.7617,lon=-80.1918}={}){
 const captures=[],answers=[],service=createWeather({fetchImpl:async(url,options)=>{const r=await fetchImpl(url,options),text=await boundedText(r,1000000,options.signal);captures.push({source_url:url,status:r.status,payload_sha256:createHash('sha256').update(text).digest('hex'),text});return new Response(text,{status:r.status,headers:r.headers});}});
 let failure;try{for(const kind of ['forecast','current','alerts'])answers.push(await service[kind]({lat,lon,...(kind==='forecast'?{hours:24}:{})}));}catch(e){failure={code:e.code??'SOURCE_ERROR',status:e.status??503,message:e.code?e.message:'Source read failed; no substituted answer.'};}
 return {checked_at:new Date().toISOString(),transport:'local_original_runtime_direct_official_NWS_not_Telegraph',planner_options:{duration_hours:3},answers,captures,...(failure?{failure}:{})};
}
async function main(){
const mode=process.argv[2]??'--help',directory=resolve('reports/weather'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
if(mode==='--help'){console.log('Use --live [latitude longitude] for original local-runtime/NWS reads, or --replay reports/weather/window-plan-TIMESTAMP.json for a historical replay without network calls. No upload, wallet, payment or Telegraph request.');}
else{
 assert(['--live','--replay'].includes(mode),'Use --live or --replay');await mkdir(directory,{recursive:true});let input,file,replay=false;
 if(mode==='--live'){
  assert([3,5].includes(process.argv.length),'Use --live or --live LAT LON');
  const lat=Number(process.argv[3]??25.7617),lon=Number(process.argv[4]??-80.1918);assert(Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180,'Invalid coordinates');
  input=await collectPlannerInputs({lat,lon});
  if(input.failure){file=resolve(directory,'window-plan-failed-'+Date.now()+'.json');await writeFile(file,JSON.stringify({input,sha256:hash(input)},null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({state:'insufficient_data',windows:[],failure:input.failure,source_file:file,all_clear:false},null,2));process.exitCode=1;return;}
  file=resolve(directory,'window-plan-'+Date.now()+'.json');
 }else{
  assert(process.argv.length===4,'Supply one local capture path');file=resolve(process.argv[3]);assert(file.startsWith(directory+sep)&&/^window-plan-\d+\.json$/.test(file.split(sep).at(-1)),'Replay only a local planner capture');assert((await stat(file)).size<=15000000,'Oversized capture');const captured=JSON.parse(await readFile(file,'utf8'));input=captured.input;assert.equal(hash(input),captured.sha256,'Captured inputs changed');replay=true;
 }
 assert(Array.isArray(input.captures)&&input.captures.length<=18&&Array.isArray(input.answers)&&input.answers.length===3,'Incomplete bounded capture');
 for(const a of input.answers)for(const s of a.sources){const c=input.captures.find(c=>c.source_url===s.source_url&&c.payload_sha256===s.payload_sha256);assert(c&&createHash('sha256').update(c.text).digest('hex')===c.payload_sha256,'Source capture hash mismatch');}
 const result=planWeatherWindows(input.answers,{...input.planner_options,now:new Date(input.checked_at)}),report={checked_at:new Date().toISOString(),historical_replay:replay,input_sha256:hash(input),result};
 if(!replay)await writeFile(file,JSON.stringify({input,sha256:hash(input),result},null,2)+'\n',{flag:'wx',mode:0o600});
 else{const captured=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(result,captured.result,'Deterministic replay changed');}
 console.log(JSON.stringify({...report,source_file:file},null,2));if(['invalid_request','insufficient_data'].includes(result.state))process.exitCode=1;
}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
