// Original runtime publication only. No wallet key, token, registration or pool upload.
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {assertPlacesSmokeBinding} from './lib/places-release.mjs';
const args=process.argv.slice(2),mode=args[0]??'--check';assert(args.length<=1&&['--check','--deploy'].includes(mode));process.chdir(resolve(import.meta.dirname,'..'));
const config=JSON.parse(await readFile('deploy/places.wrangler.jsonc','utf8'));assert.equal(config.name,'referenceforge');assert.equal(config.account_id,'35b26bd77aa13f5f1c008027783d71ca');assert.equal(config.main,'places-worker.mjs');assert.equal(config.assets.directory,'./places-public');assert.equal(config.assets.binding,'ASSETS');assert.equal(config.compatibility_date,'2026-10-23');assert(config.observability.enabled&&config.observability.traces.enabled);assert(!config.vars&&!config.routes&&!config.services&&!config.kv_namespaces&&!config.d1_databases);
const run=(program,args)=>{const r=spawnSync(program,args,{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;assert.equal(r.status,0,'Failed gate '+args[0]);};const node=args=>run(process.execPath,args),wrangler='node_modules/wrangler/bin/wrangler.js';
run('python',['tools/prepare-us-places.py']);node(['--test','test/*.test.mjs']);node(['tools/check-rpc-cleanup-worker.mjs']);node(['tools/prepare-v2-deployment.mjs']);node(['tools/validate-v2.mjs','--local']);node(['tools/prepare-places-deployment.mjs']);
node([wrangler,'deploy','--config','deploy/places.wrangler.jsonc','--dry-run','--minify','--outdir','../dist/places-worker']);node(['tools/audit-places-bundle.mjs']);
if(mode==='--check')console.log('Places runtime local gates passed. No upload or registration. Local runtime/live smoke remains a separate gate.');
else{
  const local=JSON.parse(await readFile('reports/places-provider/local-smoke.json','utf8')),audit=JSON.parse(await readFile('reports/places-provider/bundle-audit.json','utf8'));assertPlacesSmokeBinding(local,audit);
  node([wrangler,'deploy','--config','deploy/places.wrangler.jsonc','--minify','--keep-vars']);node(['tools/smoke-places.mjs','--public','--live']);
  const p=JSON.parse(await readFile('reports/places-provider/prepared.json','utf8'));await writeFile('reports/places-provider/runtime-release.json',JSON.stringify({checked_at:new Date().toISOString(),mode:'authorized original runtime upload',origin:'https://referenceforge.0xsaroj001.workers.dev',descriptor:p.outputs[0],preserved_assets:10,registry_update_sent:false,platform_admission_verified:false},null,2)+'\n');
}
