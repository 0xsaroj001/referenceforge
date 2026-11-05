// Owner-run only upload helper. --check is local; no wallet, approval or signing code.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertV2ReleaseConfig,assertV2AssetSet,assertV2AssetBytes,V2_PUBLIC_ORIGIN} from './lib/v2-release-plan.mjs';
const args=process.argv.slice(2),mode=args[0]??'--check';assert(args.length<=1&&['--check','--deploy'].includes(mode),'Use --check (no upload) or owner-only --deploy');
if(mode==='--deploy'){
  const current=await fetch(V2_PUBLIC_ORIGIN+'/health',{redirect:'error',signal:AbortSignal.timeout(15000)});assert(current.ok,'Current runtime must be identified before upload');
  const currentBody=await current.json();assert.equal(currentBody.version,'0.6.0','Use tools/release-places.mjs for a 0.7.0 runtime; this older helper must not remove its extra assets/capability');
}
process.chdir(resolve(import.meta.dirname,'..'));
const run=args=>{const r=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;assert.equal(r.status,0,'Stopped after failed gate: '+args[0]);};
assertV2ReleaseConfig(JSON.parse(await readFile('deploy/v2.wrangler.jsonc','utf8')));
run(['--test','test/*.test.mjs']);run(['tools/check-rpc-cleanup-worker.mjs']);run(['tools/prepare-v2-deployment.mjs']);run(['tools/validate-v2.mjs','--local']);
const wrangler='node_modules/wrangler/bin/wrangler.js';
run([wrangler,'deploy','--config','deploy/v2.wrangler.jsonc','--dry-run','--minify','--outdir','../dist/v2-worker']);run(['tools/audit-v2-bundle.mjs']);
const prepared=JSON.parse(await readFile('reports/v2-provider/prepared.json','utf8')),assets=assertV2AssetSet(await readdir('deploy/v2-public'),prepared);
for(const a of assets)assertV2AssetBytes(a.file,await readFile('deploy/v2-public/'+a.file),a.sha256);
if(mode==='--check'){console.log('Local V2 release gates passed. Nothing uploaded or signed. Owner upload: node tools/release-v2.mjs --deploy');}
else{
  console.log('Owner-selected upload targets referenceforge in the existing Cloudflare account. No registration or token operation.');
  run([wrangler,'deploy','--config','deploy/v2.wrangler.jsonc','--minify','--keep-vars']);
  run(['tools/validate-v2.mjs','--hosted']);
  run(['tools/smoke-v2.mjs','--public','--live']);
  await writeFile('reports/v2-provider/owner-release.json',JSON.stringify({checked_at:new Date().toISOString(),origin:V2_PUBLIC_ORIGIN,descriptor:prepared.outputs[0],uploaded_by:'owner-run CLI',registration_changed:false,platform_admission_verified:false},null,2)+'\n');
  console.log('Owner runtime upload and direct live checks passed. Authenticate at Anjoman Earn for platform validation; then inspect the current bond. No on-chain registration was sent.');
}
