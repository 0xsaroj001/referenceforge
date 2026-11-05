import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {createComparatorExecutor} from '../src/comparator-runnable.mjs';
let module,identity;try{module=await WebAssembly.compile(await readFile('dist/comparator-v2/referenceforge-comparator-v2.wasm'));identity=JSON.parse(await readFile('deploy/comparator-v2-public/identity.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const opts={skip:!module?'Prepare original artifact: node tools/build-comparator-v2.mjs':false};
const make=()=>new WebAssembly.Instance(module).exports;
const spec=(w,p,c,t)=>{const v=new DataView(w.memory.buffer);v.setBigInt64(p,c,true);v.setBigInt64(p+8,t,true);};
test('v2 has freestanding comparator exports and no retired model interface',opts,()=>{assert.deepEqual(WebAssembly.Module.imports(module),[]);const names=WebAssembly.Module.exports(module).map(x=>x.name);for(const x of ['imw_alloc','imw_free','imw_score_deterministic','memory'])assert(names.includes(x));assert(!names.includes('rank_answer'));assert(!names.some(x=>x.startsWith('imwq_')));});
test('32 live specs retain independent values and exhaustion cannot alias',opts,()=>{const w=make(),ps=Array.from({length:32},()=>w.imw_alloc(16));assert(ps.every(p=>p>0));assert.equal(new Set(ps).size,32);assert.equal(w.imw_alloc(16),0);for(let i=0;i<32;i++)spec(w,ps[i],1n,BigInt(i+1));for(let i=0;i<32;i++)assert.equal(w.imw_score_deterministic(100n,102n,ps[i]),10000n*BigInt(i)/BigInt(i+1));});
test('only exact live pointer and size can free; released slots are zeroized',opts,()=>{const w=make(),p=w.imw_alloc(16);spec(w,p,1n,10n);for(const bad of [0,-1,p+1,p+8,p+512,2147483647]){w.imw_free(bad,16);assert.equal(w.imw_score_deterministic(100n,105n,bad),-1n);}for(const size of [-1,0,8,17]){assert.equal(w.imw_alloc(size),0);w.imw_free(p,size);assert.equal(w.imw_score_deterministic(100n,105n,p),7500n);}w.imw_free(p,16);assert(new Uint8Array(w.memory.buffer,p,16).every(x=>x===0));assert.equal(w.imw_score_deterministic(100n,105n,p),-1n);w.imw_free(p,16);assert.equal(w.imw_alloc(16),p);assert(new Uint8Array(w.memory.buffer,p,16).every(x=>x===0));assert.equal(w.imw_score_deterministic(100n,105n,p),0n);});
test('WASM instances and recycled specs cannot leak into another instance',opts,()=>{const a=make(),b=make(),p=a.imw_alloc(16),q=b.imw_alloc(16);spec(a,p,1n,10n);spec(b,q,0n,0n);assert.equal(a.imw_score_deterministic(100n,105n,p),7500n);assert.equal(b.imw_score_deterministic(100n,105n,q),0n);a.imw_free(p,16);assert.equal(b.imw_score_deterministic(100n,105n,q),0n);});
test('v2 preserves numeric rule at int64 boundaries and low32 comparison codes',opts,()=>{const w=make(),p=w.imw_alloc(16),max=(1n<<63n)-1n,min=-(1n<<63n);for(const [truth,miner,c,t,want]of [[100n,100n,1n,max,1n],[10n,11n,(1n<<32n)+1n,1n,5000n],[10n**18n,101n*10n**16n,2n,100n,5000n],[min,max,1n,100n,-1n],[min,min,2n,100n,-1n],[max,min,0n,0n,0n],[0n,0n,0n,0n,-1n]]){spec(w,p,c,t);assert.equal(w.imw_score_deterministic(truth,miner,p),want);}});
test('executor advertises exact new identity and isolates concurrent requests',opts,async()=>{const app=createComparatorExecutor(module,identity),h=await(await app.fetch(new Request('https://local.test/health'))).json();assert.equal(h.artifact_keccak256,identity.artifact_keccak256);assert.equal(h.allocation_slots,32);assert.equal(h.network_admission_verified,false);const responses=await Promise.all([1,10,100].map(t=>app.fetch(new Request('https://local.test/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batch:[{ground_truth_value:100,miner_value:105,spec:[1,t]}]})})).then(r=>r.json())));assert.deepEqual(responses.map(x=>x.results[0].score),[0,7500,9750]);});

test('holding two live specs reproduces the old alias and preserves the v2 first score',opts,async t=>{
  let old;
  try{old=await readFile('deploy/v2-public/referenceforge-comparator.wasm');}
  catch(error){if(error.code!=='ENOENT')throw error;return t.skip('Prepare the original pinned artifact before this differential check');}
  assert.equal(createHash('sha256').update(old).digest('hex'),'c82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507');
  const previous=new WebAssembly.Instance(await WebAssembly.compile(old)).exports;
  const oldFirst=previous.imw_alloc(16);spec(previous,oldFirst,1n,10n);
  assert.equal(previous.imw_score_deterministic(100n,105n,oldFirst),7500n);
  const oldSecond=previous.imw_alloc(16);spec(previous,oldSecond,0n,0n);
  assert.equal(oldFirst,oldSecond);assert.equal(previous.imw_score_deterministic(100n,105n,oldFirst),0n);
  const w=make(),first=w.imw_alloc(16);spec(w,first,1n,10n);
  const second=w.imw_alloc(16);spec(w,second,0n,0n);
  assert.notEqual(first,second);assert.equal(w.imw_score_deterministic(100n,105n,first),7500n);
  assert.equal(w.imw_score_deterministic(100n,105n,second),0n);
  w.imw_free(second,16);assert.equal(w.imw_score_deterministic(100n,105n,first),7500n);
});

test('fragmented arena reuse never changes the remaining live specs',opts,()=>{
  const w=make(),pointers=Array.from({length:32},()=>w.imw_alloc(16));
  for(let i=0;i<32;i++)spec(w,pointers[i],1n,BigInt(i+1));
  const keep=pointers.filter((_,i)=>i%2),released=pointers.filter((_,i)=>!(i%2));
  const snapshot=p=>Buffer.from(new Uint8Array(w.memory.buffer,p,16));
  const before=keep.map(snapshot);
  for(const p of released){w.imw_free(p,16);assert(snapshot(p).every(x=>x===0));}
  const replacements=Array.from({length:16},()=>w.imw_alloc(16));
  assert.deepEqual([...replacements].sort((a,b)=>a-b),[...released].sort((a,b)=>a-b));
  assert.equal(w.imw_alloc(16),0);
  for(let i=0;i<keep.length;i++)assert.deepEqual(snapshot(keep[i]),before[i]);
  for(const p of replacements)assert(snapshot(p).every(x=>x===0));
  for(const p of [...keep,...replacements])w.imw_free(p,16);
  const allAgain=Array.from({length:32},()=>w.imw_alloc(16));
  assert.equal(new Set(allAgain).size,32);assert.equal(w.imw_alloc(16),0);
  for(const p of allAgain)assert(snapshot(p).every(x=>x===0));
});

test('unallocated aligned slot refuses scoring and cannot free an adjacent live slot',opts,()=>{
  const w=make(),p=w.imw_alloc(16);spec(w,p,1n,10n);
  assert.equal(w.imw_score_deterministic(100n,105n,p+16),-1n);
  w.imw_free(p+16,16);assert.equal(w.imw_score_deterministic(100n,105n,p),7500n);
  assert.equal(w.imw_alloc(16),p+16);
});

test('compiled comparator memory is bounded to the configured two MiB',opts,()=>{
  const w=make(),pages=w.memory.buffer.byteLength/65536;
  assert(pages>0&&pages<=32);w.memory.grow(32-pages);
  assert.equal(w.memory.buffer.byteLength,2097152);assert.throws(()=>w.memory.grow(1),RangeError);
});
