// Local preparation only. Fetches our existing published bytes; uploads nothing.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {boundedText} from '../src/onchain/rpc.mjs';
import {v2Descriptor,v2ContractManifest,V2_ORIGIN} from './render-v2-miner.mjs';
import {LEGACY_ASSET_HASHES} from './lib/v2-release-plan.mjs';
const old=['miner.yaml','referenceforge-unified.yaml','referenceforge-expanded.yaml','referenceforge-expanded-no-fx.yaml','referenceforge-weather.yaml','referenceforge-routing.yaml','referenceforge-comparator.wasm','artifact-manifest.json'];
const candidate=['referenceforge-v2.yaml','v2-contract-manifest.json'];
const dir='deploy/v2-public/',reportDir='reports/v2-provider/';
const sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
await mkdir(dir,{recursive:true});await mkdir(reportDir,{recursive:true});
assert((await readdir(dir)).every(x=>[...old,...candidate].includes(x)),'Unexpected file in public asset directory');
const health=await fetch(V2_ORIGIN+'/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
assert(health.ok,'Public health unavailable');const publicHealth=JSON.parse(await boundedText(health,32000));
const preserved=[];
for(const file of old){
  const r=await fetch(V2_ORIGIN+'/'+file,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok,'Existing asset unavailable: '+file);
  const reader=r.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=2_000_000,'Existing asset exceeds bound');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks);assert.equal(sha(bytes),LEGACY_ASSET_HASHES[file],'Existing public asset changed; review before packaging');await writeFile(dir+file,bytes);preserved.push({file,sha256:sha(bytes),bytes:size});
}
const artifacts=[v2Descriptor(),v2ContractManifest()],outputs=[];
for(let i=0;i<candidate.length;i++){const bytes=JSON.stringify(artifacts[i],null,2)+'\n';await writeFile(dir+candidate[i],bytes);outputs.push({file:candidate[i],url:V2_ORIGIN+'/'+candidate[i],sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});}
const report={prepared_at:new Date().toISOString(),public_health:publicHealth,preserved,outputs,status:'local_candidate_not_uploaded',source_boundary:'Original source plus our eight already-public pinned artifacts only. No research, reports, journals or evaluator questions.'};
await writeFile(reportDir+'prepared.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
