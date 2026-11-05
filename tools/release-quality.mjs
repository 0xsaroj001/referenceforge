// Owner-run Cloudflare upload. No wallet, private-key or registration operations.
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const mode=process.argv[2]??'--check';assert(['--check','--deploy'].includes(mode)&&process.argv.length<=3,'Use --check or --deploy');
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const config=JSON.parse(await readFile('deploy/weather.wrangler.jsonc','utf8'));
assert.equal(config.name,'referenceforge');assert.equal(config.account_id,'35b26bd77aa13f5f1c008027783d71ca');assert.equal(config.main,'weather-worker.mjs');
const run=(args)=>{const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;assert.equal(r.status,0,'Stopped after failed check: '+args[0]);};
run(['--test','test/*.test.mjs']);run(['tools/prepare-weather-deployment.mjs']);
const wrangler='node_modules/wrangler/bin/wrangler.js';
run([wrangler,'deploy','--config','deploy/weather.wrangler.jsonc','--dry-run','--minify','--outdir','../dist/weather-worker']);run(['tools/audit-weather-bundle.mjs']);
console.log('Verified local source/tests and eight immutable public assets. Target: referenceforge, existing Cloudflare account. No wallet transaction or research upload.');
if(mode==='--deploy'){
  run([wrangler,'deploy','--config','deploy/weather.wrangler.jsonc','--minify','--keep-vars']);
  const origin='https://referenceforge.0xsaroj001.workers.dev';
  run(['tools/smoke-quality.mjs',origin]);run(['tools/smoke-weather.mjs',origin]);run(['tools/smoke-numeric-context.mjs',origin]);run(['tools/smoke-routing.mjs',origin]);run(['tools/smoke-expanded.mjs',origin]);
  const r=await fetch(origin+'/health',{redirect:'error',signal:AbortSignal.timeout(15000)}),health=await r.json();assert.equal(r.status,200);assert.equal(health.version,'0.5.4');assert.equal(health.rpc_configuration,'alchemy_account_plus_publicnode');assert.equal(health.supported_intents.length,10);
  await mkdir('reports/network-quality',{recursive:true});await writeFile('reports/network-quality/owner-quality-release.json',JSON.stringify({checked_at:new Date().toISOString(),runtime:'0.5.4',health,uploaded_by:'owner-run CLI',registration_changed:false,scope:'Cloudflare runtime upload and bounded direct HTTP checks, not a new Telegraph score or independent adoption'},null,2)+'\n');
  console.log('Runtime 0.5.4 deployed and checked. This uploads the runtime only. Use the guarded routing repair to replace the newer two-intent registration.');
}else console.log('Nothing uploaded. Owner upload command: node tools/release-quality.mjs --deploy');
