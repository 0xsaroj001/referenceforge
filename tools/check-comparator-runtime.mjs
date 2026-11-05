// Read-only local runtime/parity/bundle gate, or bounded public executor check.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {keccak256} from 'ethers';
import {COMPARATOR_SHA256,COMPARATOR_KECCAK} from '../src/comparator-runnable.mjs';
const args=process.argv.slice(2);assert(args.length===0||args.length===1&&args[0]==='--public');
const publicMode=args.length===1,dir='dist/comparator-worker',files=await readdir(dir),wasmName=files.find(x=>x.endsWith('.wasm'));
assert(wasmName&&files.filter(x=>x.endsWith('.wasm')).length===1);
const bytes=await readFile(dir+'/'+wasmName),code=await readFile(dir+'/comparator-worker.js','utf8'),map=JSON.parse(await readFile(dir+'/comparator-worker.js.map','utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),COMPARATOR_SHA256);assert.equal(keccak256(bytes),COMPARATOR_KECCAK);
assert.equal(map.sources.length,2);assert(map.sources.every(x=>/\/(?:src\/comparator-runnable|deploy\/comparator-worker)\.mjs$/.test(x.replaceAll('\\','/'))));
assert(!/evaluator-v2|PRIVATE_KEY|local-competitor|register-wasm|research\//.test(code));
const module=await WebAssembly.compile(bytes);assert.equal(WebAssembly.Module.imports(module).length,0);
const worker=publicMode?null:new Miniflare({workers:[{config:{name:'comparator-local',compatibilityDate:'2026-10-26',manifest:{mainModule:'comparator-worker.js',modules:{'comparator-worker.js':{type:'esm',contents:code},[wasmName]:{type:'wasm',contents:bytes}}}}}]});
const origin=publicMode?'https://referenceforge-comparator.0xsaroj001.workers.dev':'http://local.test';
const request=(path,init)=>publicMode?fetch(origin+path,{...init,redirect:'error',signal:AbortSignal.timeout(15000)}):worker.dispatchFetch(origin+path,init);
const abs=n=>n<0n?-n:n,cap=n=>n>((1n<<63n)-1n)?((1n<<63n)-1n):n;
function oracle(truth,miner,kind,tolerance){if(![1n,2n].includes(kind))return truth===miner?10000:0;const error=kind===1n?abs(miner-truth):cap(abs(miner-truth)*10000n/abs(truth));if(tolerance<=0n)return error===0n?10000:0;const window=cap(tolerance*2n);return error>=window?0:Number(cap((window-error)*10000n)/window);}
const cases=[];for(const truth of [-1000000000000000000n,-1000000n,-1n,1n,100n,1000000n,1000000000000000000n])for(const kind of [0n,1n,2n,3n])for(const tolerance of [0n,1n,100n])for(const delta of [-201n,-100n,-1n,0n,1n,100n,201n])cases.push({ground_truth_value:truth,miner_value:truth+delta,spec:[kind,tolerance],want:oracle(truth,truth+delta,kind,tolerance)});
const serialize=items=>'{"batch":['+items.map(x=>`{"ground_truth_value":${x.ground_truth_value},"miner_value":${x.miner_value},"spec":[${x.spec}]}`).join(',')+']}';
const results=[];try{
  const h=await request('/health');assert.equal(h.status,200);assert.equal((await h.json()).artifact_keccak256,COMPARATOR_KECCAK);
  for(let i=0;i<cases.length;i+=100){const batch=cases.slice(i,i+100),body=serialize(batch);for(let pass=0;pass<2;pass++){const r=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(r.status,200);const j=await r.json();assert.deepEqual(j.results,batch.map(x=>({score:x.want})));}results.push({offset:i,count:batch.length,repeat_equal:true});}
  // Exactly one MiB, preserving a real request, checks the protocol body floor.
  const small=serialize(cases.slice(0,1)),r=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(1048576-Buffer.byteLength(small))+small});assert.equal(r.status,200);assert.deepEqual((await r.json()).results,[{score:cases[0].want}]);
  const bad=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body:'{"batch":[],"batch":[]}'});assert.equal(bad.status,400);
  const report={checked_at:new Date().toISOString(),public:publicMode,origin,artifact_sha256:COMPARATOR_SHA256,artifact_keccak256:COMPARATOR_KECCAK,wasm_bytes:bytes.length,bundle_modules:2,private_source_absent:true,cases:cases.length,repeated_passes:2,mismatches:0,batches:results,one_mib_accepted:true,duplicate_key_refused:true,network_admission_verified:false,scope:'Author-run documented-rule conformance and compiled-module executor parity; no hidden gate, model superiority, registration or adoption claim.'};
  await mkdir('reports/wasm-v2',{recursive:true});await writeFile('reports/wasm-v2/'+(publicMode?'public':'local')+'-executor-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await worker?.dispose();}
