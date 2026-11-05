// Original local build. Never rewrites the registered comparator artifact.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {keccak256} from 'ethers';
import {inspectWasm} from './wasm-inspect.mjs';
process.chdir(resolve(import.meta.dirname,'..'));assert.equal(process.argv.length,2);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['wasm/comparator-v2/src/lib.rs','wasm/comparator-v2/Cargo.toml','wasm/comparator-v2/Cargo.lock'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(file))])));
const rustflags='-C link-arg=--max-memory=2097152 -C link-arg=-zstack-size=65536';
const command=['build','--offline','--locked','--manifest-path','wasm/comparator-v2/Cargo.toml','--release','--target','wasm32-unknown-unknown'];
const rustc=spawnSync('rustc',['--version'],{encoding:'utf8',windowsHide:true});
if(rustc.error)throw rustc.error;assert.equal(rustc.status,0,'rustc version unavailable');
const run=spawnSync('cargo',command,{stdio:'inherit',windowsHide:true,env:{...process.env,RUSTFLAGS:rustflags}});
if(run.error)throw run.error;assert.equal(run.status,0,'Original comparator-v2 build failed');
const bytes=await readFile('wasm/comparator-v2/target/wasm32-unknown-unknown/release/referenceforge_comparator_v2.wasm');
const inspection=inspectWasm(bytes);assert(inspection.comparator&&!inspection.legacyRankAnswer&&!inspection.widePackage&&inspection.imports.length===0);
const module=await WebAssembly.compile(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);
const artifact='referenceforge-comparator-v2.wasm',sha256=createHash('sha256').update(bytes).digest('hex'),keccak=keccak256(bytes);
const identity={service:'ReferenceForge comparator v2',artifact_sha256:sha256,artifact_keccak256:keccak,abi:'imw_score_deterministic',allocation_slots:32,network_admission_verified:false};
// Refuse a build whose declared inputs changed while Cargo was running.
for(const [file,hash]of Object.entries(sourceHashes))assert.equal(sha(await readFile(file)),hash,'Build input changed: '+file);
await mkdir('dist/comparator-v2',{recursive:true});await mkdir('deploy/comparator-v2-public',{recursive:true});
await writeFile('dist/comparator-v2/'+artifact,bytes);await writeFile('deploy/comparator-v2-public/'+artifact,bytes);await writeFile('deploy/comparator-v2-public/identity.json',JSON.stringify(identity,null,2)+'\n');
const report={checked_at:new Date().toISOString(),artifact,bytes:bytes.length,sha256,keccak256:keccak,identity,inspection,status:'local_built_not_registered',change:'32 live nonaliasing spec slots; exhaustion, exact-pointer validation and zeroization. Numeric policy unchanged on shared domain.',source_sha256:sourceHashes['wasm/comparator-v2/src/lib.rs'],source_hashes:sourceHashes,build:{program:'cargo',args:command,rustflags,rustc:rustc.stdout.trim(),node:process.version,network:'offline',lockfile:'locked'}};
await writeFile('dist/comparator-v2/manifest.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,inspection:undefined},null,2));
