import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { onchainDescriptor } from './render-onchain-miner.mjs';

const root=new URL('../',import.meta.url),dir=new URL('reports/onchain-deployment/',root);
await mkdir(dir,{recursive:true});
const prepared=JSON.parse(await readFile(new URL('prepared-inputs.json',dir),'utf8'));
const origin=new URL(prepared.origin);
assert(origin.protocol==='https:'&&origin.hostname==='referenceforge-onchain.0xsaroj001.workers.dev','Unexpected public smoke target');
const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=[];let descriptor;
async function check(id,path,status,verify,options={}) {
  const started=performance.now();
  try {
    const r=await fetch(new URL(path,origin),{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
    const bytes=Buffer.from(await r.arrayBuffer());assert.equal(r.status,status,id);
    const body=JSON.parse(bytes.toString('utf8'));await verify?.(body,r,bytes);
    rows.push({id,pass:true,http:r.status,latency_ms:performance.now()-started,...(body.duration_ms!==undefined?{worker_duration_ms:body.duration_ms}:{})});return body;
  } catch(e) {rows.push({id,pass:false,error:e.message,latency_ms:performance.now()-started});}
}
descriptor=await check('hosted-yaml-exact-bytes','/miner.yaml',200,async(body,r,bytes)=>{
  assert.equal('0x'+sha(bytes),prepared.yaml_sha256);
  assert(bytes.equals(await readFile(new URL('deploy/onchain-public/miner.yaml',root))));
  assert.match(r.headers.get('content-type'),/yaml/);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(body,onchainDescriptor({id:prepared.candidate_id,baseUrl:prepared.origin}));
  await mkdir(new URL('dist/upload-verified-onchain/',root),{recursive:true});await writeFile(new URL('dist/upload-verified-onchain/miner.yaml',root),bytes);
});
await check('health-two-intents','/health',200,a=>assert.deepEqual(a.supported_intents,['CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY']));
await check('transfer-required-params','/verify-transfer',422,a=>assert.equal(a.verified_answer,false));
await check('metric-required-params','/onchain-metric',422,a=>assert.equal(a.verified_answer,false));
await check('private-reports-absent','/reports/verification.json',404);
await check('research-absent','/research/',404);
await check('environment-absent','/.env',404);
await check('no-signing-route','/sign',404);
await check('duplicate-query-refused','/verify-transfer?chain=base&chain=base-sepolia',400);
const live=JSON.parse(await readFile(new URL('reports/onchain-miner/live-benchmark.json',root),'utf8'));
for(const chain of ['base','base-sepolia'])for(const kind of ['transfer','metric']) {
  // Exercise shared public RPCs at a bounded smoke-test rate, not burst load.
  await new Promise(resolve=>setTimeout(resolve,1100));
  const example=live.rows.find(x=>x.kind===kind&&x.params.chain===chain&&x.http_status===200&& (kind==='transfer'?x.answer.claim_verified:true));
  assert(example,'Missing captured live example');
  const path=(kind==='transfer'?'/verify-transfer':'/onchain-metric')+'?'+new URLSearchParams(example.params);
  await check('public-'+chain+'-'+kind,path,200,a=>{assert.equal(a.verified_answer,true);assert.equal(a.score_value,example.answer.score_value);if(kind==='transfer')assert.equal(a.claim_verified,true);});
}
if(descriptor){await new Promise(resolve=>setTimeout(resolve,1100));const p=live.rows.find(x=>x.kind==='transfer'&&x.http_status===200&&x.answer.claim_verified).params;await check('public-post-json','/verify-transfer',200,a=>assert.equal(a.claim_verified,true),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});}
const before=JSON.parse(await readFile(new URL('existing-worker-before.json',dir),'utf8'));
for(const expected of before){try{const r=await fetch('https://referenceforge.0xsaroj001.workers.dev/'+expected.file,{signal:AbortSignal.timeout(10000)});const b=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);assert.equal(sha(b),expected.sha256);rows.push({id:'existing-worker-unchanged-'+expected.file,pass:true});}catch(e){rows.push({id:'existing-worker-unchanged-'+expected.file,pass:false,error:e.message});}}
const result={verified_at:new Date().toISOString(),origin:prepared.origin,yaml_url:prepared.yaml_url,yaml_sha256:prepared.yaml_sha256,yaml_bytes:prepared.bytes,candidate_id:prepared.candidate_id,identity_reserved:false,requires_api_key:false,intents:prepared.supported_intents,checks:{total:rows.length,passed:rows.filter(x=>x.pass).length},rows,status:rows.every(x=>x.pass)?'public_hosting_and_smoke_verified_platform_validation_pending':'public_smoke_incomplete',onchain_registration_sent:false,network_admission_verified:false,privacy:'Only original runtime and one YAML asset; research and generated reports stay local'};
await writeFile(new URL('verified-inputs.json',dir),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));if(rows.some(x=>!x.pass))process.exitCode=1;
