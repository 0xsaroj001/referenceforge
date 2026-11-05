import assert from 'node:assert/strict';import {readFile,readdir,writeFile,mkdir,copyFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {placesDescriptor,placesContractManifest,V2_ORIGIN} from './render-places-miner.mjs';
import {assertV2AssetSet,assertV2AssetBytes} from './lib/v2-release-plan.mjs';
const sha=b=>'0x'+createHash('sha256').update(b).digest('hex'),prepared=JSON.parse(await readFile('reports/v2-provider/prepared.json','utf8'));
const old=assertV2AssetSet(await readdir('deploy/v2-public'),prepared),names=['referenceforge-places-v2.yaml','v2-places-contract-manifest.json'],dir='deploy/places-public';
await mkdir(dir,{recursive:true});assert((await readdir(dir)).every(x=>[...old.map(a=>a.file),...names].includes(x)),'Unexpected public file');
const data=await readFile('dist/census/us-places-2026.json');assert.equal(sha(data),'0x7ca6c01a06552fdfb0844973c8a18c48f107ca399d9a4a71412dfbf33a34e826','Census data drift');
for(const a of old){const bytes=await readFile('deploy/v2-public/'+a.file);assertV2AssetBytes(a.file,bytes,a.sha256);await copyFile('deploy/v2-public/'+a.file,dir+'/'+a.file);}
const documents=[placesDescriptor(),placesContractManifest()],outputs=[];for(let i=0;i<names.length;i++){const bytes=JSON.stringify(documents[i],null,2)+'\n';await writeFile(dir+'/'+names[i],bytes);outputs.push({file:names[i],url:V2_ORIGIN+'/'+names[i],sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});}
await mkdir('reports/places-provider',{recursive:true});const report={prepared_at:new Date().toISOString(),preserved:old,outputs,data_sha256:sha(data),source_scope:'Original code plus pinned public Census place/state data. No private corpus, report, research or signing code.',uploaded:false};await writeFile('reports/places-provider/prepared.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({preserved_assets:old.length,outputs,data_bytes:data.length},null,2));
