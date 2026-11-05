import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {evaluateForecastPlan} from '../tools/lib/weather-evaluation.mjs';
const cli=fileURLToPath(new URL('../tools/prospective-baseline.mjs',import.meta.url));
const noNetwork='data:text/javascript,'+encodeURIComponent('globalThis.fetch=()=>{throw Error("Unexpected network request")};');
async function fixture(t,{future=false,result=true}={}){
  const cwd=await mkdtemp(join(tmpdir(),'referenceforge-baseline-cli-'));
  t.after(async()=>{assert(resolve(cwd).startsWith(resolve(tmpdir())+'\\referenceforge-baseline-cli-')||resolve(cwd).startsWith(resolve(tmpdir())+'/referenceforge-baseline-cli-'));await rm(cwd,{recursive:true,force:true});});
  const year=future?'2099':'2000',file='prospective-baseline-'+year+'-01-01.json',dir=join(cwd,'reports/weather');await mkdir(dir,{recursive:true});
  const plan={captured_at:year+'-01-01T00:00:00Z',cases:[{city:'Fixture',station:{id:'KAAA',distance_km:2},captured_at:year+'-01-01T00:00:00Z',forecast_issued_at:year+'-01-01T00:00:00Z',hourly:[{time:year+'-01-01T01:00:00Z',temperature_c:20}],baseline:{kind:'persistence_temperature',station_id:'KAAA',observed_at:year+'-01-01T00:00:00Z',temperature_c:19}}]};
  const sha256=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  await writeFile(join(dir,'prospective-baseline-latest.json'),JSON.stringify({file}));await writeFile(join(dir,file),JSON.stringify({plan,sha256}));
  const resultFile=join(dir,'baseline-result-'+file);
  if(result){const checked_at=year+'-01-01T02:00:00Z',r={checked_at,frozen_plan_sha256:sha256,...evaluateForecastPlan(plan,[{station:'KAAA',complete:true,observations:[{station:'https://api.weather.gov/stations/KAAA',timestamp:year+'-01-01T01:00:00Z',temperature:{value:19,unitCode:'wmoUnit:degC',qualityControl:'V'}}]}],{now:new Date(checked_at)})};await writeFile(resultFile,JSON.stringify(r));}
  return {cwd,resultFile,run:mode=>JSON.parse(execFileSync(process.execPath,['--import',noNetwork,cli,mode],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}))};
}
test('completed status and repeated evaluation reuse frozen results with zero network access or writes',async t=>{
  const f=await fixture(t),before=await readFile(f.resultFile,'utf8');
  for(const mode of ['--status','--evaluate']){const r=f.run(mode);assert.equal(r.state,'evaluated');assert.equal(r.network_refresh,false);assert.equal(r.paired_hours,1);assert.equal(r.mae_skill_vs_persistence,null);}
  assert.equal(await readFile(f.resultFile,'utf8'),before);
});
test('saved results with changed hash, premature date or inconsistent counts fail without refreshing',async t=>{
  const f=await fixture(t),original=JSON.parse(await readFile(f.resultFile,'utf8'));
  for(const change of [r=>r.frozen_plan_sha256='bad',r=>r.checked_at='2000-01-01T01:00:00Z',r=>r.paired_hours=2,r=>r.forecast_hours=2]){const r=structuredClone(original);change(r);await writeFile(f.resultFile,JSON.stringify(r));assert.throws(()=>f.run('--evaluate'));}
});
test('immature sample remains waiting with no evaluation or network request',async t=>{
  const f=await fixture(t,{future:true,result:false});for(const mode of ['--status','--evaluate']){const r=f.run(mode);assert.equal(r.state,'waiting_for_future_observations');assert.equal(r.skill_measured,false);}
});
