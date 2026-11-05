// Local contract/byte checks by default. Optional platform POST does not register.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {checkDescriptorContracts,checkPlatformValidation,postPlatformValidation,bytesHash} from './lib/v2-validation.mjs';
const args=process.argv.slice(2);assert(args.every(x=>['--local','--hosted','--platform'].includes(x)),'Use --local, --hosted or --platform; no keys accepted');
const prepared=JSON.parse(await readFile('reports/v2-provider/prepared.json','utf8')),artifact=prepared.outputs.find(x=>x.file==='referenceforge-v2.yaml'),bytes=await readFile('deploy/v2-public/'+artifact.file),yaml=bytes.toString('utf8'),descriptor=JSON.parse(yaml),contracts=JSON.parse(await readFile('contracts/v2-intents.json','utf8')).contracts;
assert.equal(bytesHash(bytes),artifact.sha256,'Candidate bytes changed after preparation');
const report={checked_at:new Date().toISOString(),sha256:artifact.sha256,...checkDescriptorContracts(descriptor,contracts),hosted_bytes_verified:false,platform_validated:false,transaction_ready:false};
if(args.includes('--hosted')){const r=await fetch(artifact.url,{redirect:'error',signal:AbortSignal.timeout(10000)});assert(r.ok,'Candidate is not hosted. Owner deployment remains required.');const body=await r.arrayBuffer();assert(body.byteLength<=128000);assert.equal(bytesHash(Buffer.from(body)),artifact.sha256);report.hosted_bytes_verified=true;}
if(args.includes('--platform')){report.platform=await postPlatformValidation(yaml);try{checkPlatformValidation(report.platform.status,report.platform.body,descriptor);report.platform_validated=true;}catch(error){report.platform_error=error.message;process.exitCode=1;}}
await mkdir('reports/v2-provider',{recursive:true});await writeFile('reports/v2-provider/validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
