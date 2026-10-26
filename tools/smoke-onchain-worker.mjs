import assert from 'node:assert/strict';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
const origin=process.argv[2]??'http://127.0.0.1:8791';
const url=new URL(origin);if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('This smoke tool is restricted to the local Worker');
const rows=[];
async function check(id,path,options,status,verify){const t=performance.now(),r=await fetch(new URL(path,url),options),a=await r.json();assert.equal(r.status,status,id);verify?.(a);rows.push({id,status:r.status,latency_ms:performance.now()-t,pass:true});}
await check('health','/health',{},200,a=>assert.deepEqual(a.supported_intents,['CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY']));
await check('missing-parameters','/verify-transfer',{},422,a=>assert.equal(a.verified_answer,false));
await check('private-research-not-served','/research/local-competitor-audit/',{},404);
await check('signing-endpoint-absent','/sign',{method:'POST'},404);
await check('duplicate-input','/verify-transfer?chain=base&chain=base-sepolia',{},400);
await check('invalid-json','/verify-transfer',{method:'POST',headers:{'content-type':'application/json'},body:'['},400);
await check('oversized-json','/verify-transfer',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(16385)},400);
const live=JSON.parse(await readFile(new URL('../reports/onchain-miner/live-benchmark.json',import.meta.url),'utf8'));
for(const kind of ['transfer','metric']){
  const example=live.rows.find(x=>x.kind===kind&&x.http_status===200);
  const path=(kind==='transfer'?'/verify-transfer':'/onchain-metric')+'?'+new URLSearchParams(example.params);
  await check('workerd-real-'+kind,path,{},200,a=>{assert.equal(a.verified_answer,true);if(kind==='transfer')assert.equal(a.claim_verified,example.answer.claim_verified);else assert.equal(a.score_value,example.answer.score_value);});
}
const report={checked_at:new Date().toISOString(),scope:'Real local workerd with two live source reads plus transport/error checks; not public deployment or measured production CPU',total:rows.length,passed:rows.filter(x=>x.pass).length,rows};
await mkdir(new URL('../reports/onchain-miner/',import.meta.url),{recursive:true});await writeFile(new URL('../reports/onchain-miner/worker-smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
