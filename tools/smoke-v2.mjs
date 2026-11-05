// No paid node asks or wallet operations. --live adds five bounded source workflows.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkCanonicalAnswer} from './lib/v2-validation.mjs';
const args=process.argv.slice(2);assert(args.every(x=>['--live','--public'].includes(x)),'Use optional --live or --public only');
const origin=args.includes('--public')?'https://referenceforge.0xsaroj001.workers.dev':'http://127.0.0.1:8795',checks=[];
const contracts=JSON.parse(await readFile('contracts/v2-intents.json','utf8')).contracts;
async function get(path){const start=performance.now(),r=await fetch(origin+path,{signal:AbortSignal.timeout(45000)}),body=await r.json();return {path,status:r.status,ms:Math.round(performance.now()-start),body};}
const health=await get('/health');assert.equal(health.status,200);assert(['0.6.0','0.7.0'].includes(health.body.version));assert.equal(health.body.supported_intents.length,5);checks.push(health);
const prepared=JSON.parse(await readFile('reports/v2-provider/prepared.json','utf8'));
for(const a of [...prepared.preserved,...prepared.outputs]){const r=await fetch(origin+'/'+a.file,{signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);assert.equal('0x'+createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),a.sha256);}
for(const path of ['/v2/macro','/v2/tx','/v2/wallet','/v2/weather/current','/v2/weather/forecast','/wallet-balance']){const r=await get(path);assert.equal(r.status,422);assert(r.body.error.code);checks.push(r);}
for(const path of ['/reports/private.json','/research/local-competitor-audit/README.md','/evaluator-v2/local/tx-evidence-cases.json'])assert.equal((await get(path)).status,404);
if(args.includes('--live'))for(const path of [
  '/v2/macro?indicator=unemployment%20rate&country=IN&year=2024',
  '/v2/weather/current?location=39.0997,-94.5786',
  '/v2/weather/forecast?location=39.0997,-94.5786&window_hours=6',
  '/v2/wallet?chain=base-sepolia&address=0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3',
  '/v2/tx?chain=base&tx_hash=0x32078297315103b71207603e5efd337e8d132358facbf7453036ee1ce5e78da6'
]){try{const result=await get(path);if(result.status===200){try{result.conformance=checkCanonicalAnswer(result.body,contracts.find(c=>c.intent===result.body.intent));}catch(error){result.conformance_error=error.message;}}checks.push(result);}catch(error){checks.push({path,status:'transport_failure',code:error.name});}}
const real=checks.filter(x=>x.path.includes('?')),report={checked_at:new Date().toISOString(),runtime:args.includes('--public')?'public existing-account Worker':'local workerd via pinned Wrangler, existing compatibility date',public_deployment:args.includes('--public'),platform_admission_verified:false,assets_verified:10,boundary_checks_passed:true,live_success_count:real.filter(x=>x.status===200&&!x.conformance_error).length,live_attempt_count:real.length,checks};
await mkdir('reports/v2-provider',{recursive:true});await writeFile('reports/v2-provider/'+(args.includes('--public')?'public-':'')+(args.includes('--live')?'worker-smoke-live.json':'worker-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,checks:checks.map(({body,...r})=>({...r,...(body?.error?{error:body.error}:{intent:body?.intent})}))},null,2));
if(real.some(x=>x.status!==200||x.conformance_error))process.exitCode=1;
