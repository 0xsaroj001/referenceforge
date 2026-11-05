// Local-only workerd, ABI and bundle gate. No account, upstream or registry access.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
import {keccak256} from 'ethers';
process.chdir(resolve(import.meta.dirname,'..'));
const args=process.argv.slice(2);
assert(args.length===0||args.length===1&&args[0]==='--require-private-replay','This gate is local-only; only --require-private-replay is accepted');
const requirePrivateReplay=args.length===1;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const startedAt=new Date().toISOString(),outputRoot='reports/comparator-proof-2026-11-03';
const output=`${outputRoot}/runtime-${startedAt.replaceAll(':','-').replaceAll('.','-')}.json`;
await mkdir(outputRoot,{recursive:true});
const report={started_at:startedAt,pass:false,status:'started_not_completed',public:false,network_admission_verified:false,
  scope:'Author-run local ABI/runtime compatibility and old-binary parity; no hidden gate, model-quality, independent adoption or registration claim.'};
report.checker_sha256=sha(await readFile(import.meta.filename));
report.runtime={node:process.version,miniflare:JSON.parse(await readFile(new URL('../../package.json',import.meta.resolve('miniflare')),'utf8')).version,compatibility_date:'2026-10-26'};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(`${outputRoot}/latest-runtime.json`,JSON.stringify({started_at:startedAt,report:output},null,2)+'\n');
let worker;
try {
  const folder='dist/comparator-v2-worker',identity=JSON.parse(await readFile('deploy/comparator-v2-public/identity.json','utf8'));
  const files=await readdir(folder),wasmFiles=files.filter(x=>x.endsWith('.wasm'));assert.equal(wasmFiles.length,1,'Exactly one compiled comparator is required');
  const bytes=await readFile(`${folder}/${wasmFiles[0]}`),code=await readFile(`${folder}/comparator-v2-worker.js`,'utf8');
  const map=JSON.parse(await readFile(`${folder}/comparator-v2-worker.js.map`,'utf8'));
  const configBytes=await readFile('deploy/comparator-v2.wrangler.jsonc'),config=JSON.parse(configBytes);
  assert.equal(sha(bytes),identity.artifact_sha256,'Bundled artifact hash drift');assert.equal(keccak256(bytes),identity.artifact_keccak256);
  assert.equal(map.sourceRoot,'../dist/comparator-v2-worker');
  const allowed=['deploy/comparator-v2-worker.mjs','deploy/comparator-v2-public/identity.json','src/comparator-runnable.mjs'];
  assert.equal(map.sources.length,allowed.length);assert.deepEqual(map.sources.map(p=>resolve(folder,p)).sort(),allowed.map(p=>resolve(p)).sort());
  for(let i=0;i<map.sources.length;i++)assert.equal(map.sourcesContent[i],await readFile(resolve(folder,map.sources[i]),'utf8'),'Stale bundled source');
  assert(!/evaluator-v2|local-competitor|PRIVATE_KEY|registerWasm|research\//.test(code));
  assert.deepEqual((await readdir('deploy/comparator-v2-public')).sort(),['identity.json','referenceforge-comparator-v2.wasm']);
  for(const file of ['deploy/comparator-v2-public/referenceforge-comparator-v2.wasm','dist/comparator-v2/referenceforge-comparator-v2.wasm'])assert.equal(sha(await readFile(file)),identity.artifact_sha256);
  const build=JSON.parse(await readFile('dist/comparator-v2/manifest.json','utf8'));
  assert.equal(build.sha256,identity.artifact_sha256);assert.equal(build.status,'local_built_not_registered');
  assert.deepEqual(Object.keys(build.source_hashes).sort(),['wasm/comparator-v2/Cargo.lock','wasm/comparator-v2/Cargo.toml','wasm/comparator-v2/src/lib.rs']);
  for(const [file,hash]of Object.entries(build.source_hashes))assert.equal(sha(await readFile(file)),hash,'Build input drift: '+file);
  assert(build.build.args.includes('--offline')&&build.build.args.includes('--locked'));
  const module=await WebAssembly.compile(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.deepEqual(WebAssembly.Module.exports(module).map(x=>x.name).sort(),['imw_alloc','imw_free','imw_score_deterministic','memory']);
  const old=await readFile('deploy/v2-public/referenceforge-comparator.wasm');assert.equal(sha(old),'c82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507');
  const previous=new WebAssembly.Instance(await WebAssembly.compile(old)).exports,oldPointer=previous.imw_alloc(16);
  const candidate=new WebAssembly.Instance(module).exports,candidatePointer=candidate.imw_alloc(16);assert(oldPointer>0&&candidatePointer>0);
  const max=(1n<<63n)-1n,min=-(1n<<63n),abs=x=>x<0n?-x:x,cap=x=>x>max?max:x;
  function expected(t,m,c,tol){
    c=BigInt.asIntN(32,c);let score;
    if(t===0n)score=-1n;
    else if(c!==1n&&c!==2n)score=t===m?10000n:0n;
    else if(abs(m-t)>max||c===2n&&t===min)score=-1n;
    else {const error=c===1n?abs(m-t):cap(abs(m-t)*10000n/abs(t)),band=cap(tol*2n);
      score=tol<=0n?(error===0n?10000n:0n):error>=band?0n:cap(10000n*(band-error))/band;}
    return score<0n?{error:'COMPARATOR_REFUSED'}:{score:Number(score)};
  }
  const cases=[];
  for(const truth of [-(10n**18n),-1000000n,-1n,1n,100n,1000000n,10n**18n])for(const kind of [0n,1n,2n,3n])for(const tolerance of [0n,1n,100n])for(const delta of [-201n,-100n,-1n,0n,1n,100n,201n])cases.push({truth,miner:truth+delta,kind,tolerance});
  for(const truth of [min,max,0n])for(const kind of [0n,1n,2n,(1n<<32n)+1n])for(const tolerance of [-1n,max])cases.push({truth,miner:truth===max?min:max,kind,tolerance});
  const set=(wasm,pointer,value)=>{const view=new DataView(wasm.memory.buffer);view.setBigInt64(pointer,value.kind,true);view.setBigInt64(pointer+8,value.tolerance,true);};
  for(const value of cases)for(const [wasm,pointer,label]of [[previous,oldPointer,'Old shared numeric policy'],[candidate,candidatePointer,'Candidate numeric policy']]){
    set(wasm,pointer,value);const score=wasm.imw_score_deterministic(value.truth,value.miner,pointer);
    assert.deepEqual(score<0n?{error:'COMPARATOR_REFUSED'}:{score:Number(score)},expected(value.truth,value.miner,value.kind,value.tolerance),label);
  }
  previous.imw_free(oldPointer,16);candidate.imw_free(candidatePointer,16);
  // Preserve the original freeze and results: replay its data without its report writer.
  const reviewRoot='reports/evaluator-expansion-2026-11-02/review';
  let freezeBytes;
  try{freezeBytes=await readFile(`${reviewRoot}/freeze.json`);}catch(error){if(error.code!=='ENOENT')throw error;}
  report.private_replay={required:requirePrivateReplay,performed:false,count:0,status:'not_run_missing_protected_local_data'};
  if(freezeBytes){
    const freeze=JSON.parse(freezeBytes);
    for(const [file,hash]of Object.entries(freeze.files)){
      assert(!file.includes('/')&&!file.includes('\\'),'Frozen filename must be local');
      assert.equal(sha(await readFile(`${reviewRoot}/${file}`)),hash,'Frozen evidence drift');
    }
    const frozen=JSON.parse(await readFile(`${reviewRoot}/frozen-cases.json`,'utf8'));
    assert.equal(frozen.cases.length,freeze.cases);assert(frozen.cases.length>0);
    for(const value of frozen.cases){const pointer=candidate.imw_alloc(16);set(candidate,pointer,{kind:BigInt(value.code),tolerance:BigInt(value.tolerance)});
      assert.equal(candidate.imw_score_deterministic(BigInt(value.truth),BigInt(value.miner),pointer),BigInt(value.expected),value.id);candidate.imw_free(pointer,16);}
    report.private_replay={required:requirePrivateReplay,performed:true,count:frozen.cases.length,hash:freeze.files['frozen-cases.json'],status:'passed'};
  }else assert(!requirePrivateReplay,'Required protected private replay is absent');
  // Installed Miniflare config API, built module and real static-asset directory.
  assert.equal(config.assets.binding,'ASSETS');assert.equal(config.assets.run_worker_first,true);assert.equal(config.compatibility_date,'2026-10-26');
  worker=new Miniflare({workers:[{config:{name:'comparator-v2-local',compatibilityDate:config.compatibility_date,
    manifest:{mainModule:'comparator-v2-worker.js',modules:{'comparator-v2-worker.js':{type:'esm',contents:code},[wasmFiles[0]]:{type:'wasm',contents:bytes}}},
    env:{ASSETS:{type:'assets'}},assets:{directory:resolve('deploy',config.assets.directory),runWorkerFirst:true,hasUserWorker:true}}}]});
  const request=(path,init)=>worker.dispatchFetch('http://local.test'+path,init);
  const health=await request('/health');assert.equal(health.status,200,await health.clone().text());const h=await health.json();
  assert.equal(h.artifact_keccak256,identity.artifact_keccak256);assert.equal(h.artifact_sha256,identity.artifact_sha256);assert.equal(h.allocation_slots,32);assert.equal(h.network_admission_verified,false);
  const artifact=await request('/referenceforge-comparator-v2.wasm');assert.equal(artifact.status,200);assert.equal(sha(Buffer.from(await artifact.arrayBuffer())),identity.artifact_sha256);
  const serialize=items=>'{"batch":['+items.map(v=>`{"ground_truth_value":${v.truth},"miner_value":${v.miner},"spec":[${v.kind},${v.tolerance}]}`).join(',')+']}';
  for(let i=0;i<cases.length;i+=100){const batch=cases.slice(i,i+100);for(let pass=0;pass<2;pass++){
    const response=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body:serialize(batch)});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).results,batch.map(v=>expected(v.truth,v.miner,v.kind,v.tolerance)));}}
  const small=serialize(cases.slice(0,1)),boundary=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(1048576-Buffer.byteLength(small))+small});
  assert.equal(boundary.status,200);assert.deepEqual((await boundary.json()).results,[expected(cases[0].truth,cases[0].miner,cases[0].kind,cases[0].tolerance)]);
  const duplicate=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body:'{"batch":[],"batch":[]}'});assert.equal(duplicate.status,400);assert.equal((await duplicate.json()).error,'DUPLICATE_JSON_KEY');
  // Stream without Content-Length to exercise the actual reader limit. Early header
  // rejection can close a loopback HTTP socket while its client is still uploading.
  const oversizedBody=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(1048577)));controller.close();}});
  const oversized=await request('/run',{method:'POST',headers:{'content-type':'application/json'},body:oversizedBody,duplex:'half'});assert.equal(oversized.status,413);assert.equal((await oversized.json()).error,'BODY_TOO_LARGE');
  const concurrent=await Promise.all([1n,10n,100n].map(tolerance=>request('/run',{method:'POST',headers:{'content-type':'application/json'},body:serialize([{truth:100n,miner:105n,kind:1n,tolerance}])}).then(r=>r.json())));
  assert.deepEqual(concurrent.map(x=>x.results[0].score),[0,7500,9750]);
  for(const path of ['/identity.json','/reports/private.json','/evaluator-v2/local/tx-evidence-cases.json'])assert.equal((await request(path)).status,404);
  Object.assign(report,{status:'checks_completed',artifact_sha256:identity.artifact_sha256,artifact_keccak256:identity.artifact_keccak256,wasm_bytes:bytes.length,
    bundle_sha256:sha(code),config_sha256:sha(configBytes),sources:Object.fromEntries(await Promise.all(allowed.map(async file=>[file,sha(await readFile(file))]))),build_inputs:build.source_hashes,build:build.build,
    source_content_matches:true,private_source_absent:true,imports:0,numeric_cases:cases.length,repeated_passes:2,mismatches:0,old_shared_policy_matches:cases.length,
    one_mib_accepted:true,over_one_mib_refused:true,
    duplicate_key_refused:true,concurrent_requests_isolated:true,asset_hash_matches:true});
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack,cause:error.cause?.message};process.exitCode=1;}
finally{
  try{await worker?.dispose();}catch(error){report.status='failed';report.cleanup_error=error.message;process.exitCode=1;}
  report.completed_at=new Date().toISOString();report.pass=report.status==='checks_completed';
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,report:output},null,2));
}
