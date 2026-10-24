import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=process.argv[2]??'http://127.0.0.1:8788', checks=[];
for(const [path,expected]of [['/health',200],['/fx?base=USD&quote=INR',200],['/macro?country=US&indicator=unemployment&year=2019',200],['/fx?question=spot%20USD%20to%20INR',422],['/miner.yaml',200],['/referenceforge-comparator.wasm',200],['/artifact-manifest.json',200],['/research/local-competitor-audit/',404]]){
  const start=performance.now();try{const r=await fetch(base+path,{signal:AbortSignal.timeout(12000)});const bytes=Buffer.from(await r.arrayBuffer());let body;try{body=JSON.parse(bytes.toString())}catch{body=null;}checks.push({path,status:r.status,expected_status:expected,pass:r.status===expected,duration_ms:performance.now()-start,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...(body?{body}:{})});}catch(e){checks.push({path,pass:false,error:e.message});}
}
const meta=checks.find(c=>c.path==='/artifact-manifest.json')?.body;
const consistent=checks.find(c=>c.path==='/miner.yaml')?.sha256===meta?.yaml_sha256?.slice(2)&&checks.find(c=>c.path==='/referenceforge-comparator.wasm')?.sha256===meta?.wasm.sha256;
const report={checked_at:new Date().toISOString(),base_url:base,scope:new URL(base).hostname==='127.0.0.1'?'Local workerd emulator, not public deployment or free-plan CPU policy proof':'Public HTTP artifact/source smoke only, not Telegraph validation or registration',checks,asset_hashes_consistent:consistent};
await writeFile(new URL('../reports/worker-local-smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,checks:checks.map(({body,...r})=>r),asset_hashes_consistent:consistent},null,2));
if(checks.some(c=>!c.pass)||!consistent)process.exitCode=1;
