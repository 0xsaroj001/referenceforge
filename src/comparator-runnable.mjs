// Public executor for the original, byte-pinned comparator. No RPC or truth lookup.
export const COMPARATOR_SHA256='c82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507';
export const COMPARATOR_KECCAK='0xc6943a7d9d0af1d20a76dc88020bbd6a78b0fc687e681e58912080053c73e2a7';
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const fail=code=>{throw Object.assign(new Error(code),{code});};

// Read integer lexemes directly: ordinary JSON.parse would round int64 inputs.
// Keys are decoded before duplicate checks; depth and item budgets are bounded.
export function parseIntegerJson(raw){
  let pos=0,items=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(raw[pos]??'')&&pos<raw.length)pos++;};
  function string(){const start=pos++;for(;pos<raw.length;pos++){if(raw[pos]==='\\')pos++;else if(raw[pos]==='"'){pos++;return JSON.parse(raw.slice(start,pos));}}fail('INVALID_JSON');}
  function value(depth){
    if(depth>8||++items>3000)fail('JSON_LIMIT');ws();const c=raw[pos];
    if(c==='"')return string();
    if(c==='{'||c==='['){
      const object=c==='{',out=object?Object.create(null):[],keys=new Set(),end=object?'}':']';pos++;ws();
      if(raw[pos]===end){pos++;return out;}
      for(;;){ws();let key;if(object){if(raw[pos]!=='"')fail('INVALID_JSON');key=string();if(keys.has(key))fail('DUPLICATE_JSON_KEY');keys.add(key);ws();if(raw[pos++]!==':')fail('INVALID_JSON');}
        const item=value(depth+1);if(object)out[key]=item;else out.push(item);ws();const next=raw[pos++];if(next===end)return out;if(next!==',')fail('INVALID_JSON');
      }
    }
    for(const [token,result]of [['null',null],['true',true],['false',false]])if(raw.startsWith(token,pos)){pos+=token.length;return result;}
    const match=/^-?(?:0|[1-9][0-9]*)/.exec(raw.slice(pos));if(!match)fail('INVALID_JSON');pos+=match[0].length;
    if(/[.eE0-9]/.test(raw[pos]??''))fail('INTEGER_REQUIRED');if(match[0].length>20)fail('INT64_RANGE');return BigInt(match[0]);
  }
  const result=value(0);ws();if(pos!==raw.length)fail('INVALID_JSON');return result;
}
const int64=x=>typeof x==='bigint'&&x>=MIN&&x<=MAX;
const fields=(o,names)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===names.length&&names.every(k=>Object.hasOwn(o,k));
export function scoreComparatorBatch(module,body){
  if(!fields(body,['batch'])||!Array.isArray(body.batch)||body.batch.length<1||body.batch.length>100)fail('INVALID_BATCH');
  // Isolated instance and memory per request; no shared spec buffer across calls.
  const wasm=new WebAssembly.Instance(module).exports,pointer=wasm.imw_alloc(16);
  if(!Number.isInteger(pointer)||pointer<=0)fail('ALLOCATION_FAILED');
  try{return {results:body.batch.map(question=>{
    if(!fields(question,['ground_truth_value','miner_value','spec'])||!int64(question.ground_truth_value)||!int64(question.miner_value)||!Array.isArray(question.spec)||question.spec.length!==2||!question.spec.every(int64))return {error:'INVALID_COMPARATOR_INPUT'};
    const view=new DataView(wasm.memory.buffer);view.setBigInt64(pointer,question.spec[0],true);view.setBigInt64(pointer+8,question.spec[1],true);
    const score=wasm.imw_score_deterministic(question.ground_truth_value,question.miner_value,pointer);
    return score<0n||score>10000n?{error:'COMPARATOR_REFUSED'}:{score:Number(score)};
  })};}finally{wasm.imw_free(pointer,16);}
}
async function boundedBody(request){
  const limit=1048576,declared=request.headers.get('content-length');if(declared&&(!/^[0-9]+$/.test(declared)||BigInt(declared)>BigInt(limit)))fail('BODY_TOO_LARGE');
  if(!request.body)fail('INVALID_JSON');const reader=request.body.getReader(),chunks=[];let total=0,timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('READ_TIMEOUT'),{code:'READ_TIMEOUT'})),10000);});
  try{for(;;){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;total+=value.byteLength;if(total>limit)fail('BODY_TOO_LARGE');chunks.push(value);}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }finally{clearTimeout(timer);reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createComparatorExecutor(module,identity={service:'ReferenceForge original comparator executor',artifact_keccak256:COMPARATOR_KECCAK,artifact_sha256:COMPARATOR_SHA256}){return {async fetch(request){
  const path=new URL(request.url).pathname,headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
  if(path==='/health'&&request.method==='GET')return Response.json({...identity,abi:'imw_score_deterministic',network_admission_verified:false},{headers});
  if(path!=='/run')return Response.json({error:'NOT_FOUND'},{status:404,headers});
  if(request.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405,headers:{...headers,allow:'POST'}});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return Response.json({error:'JSON_REQUIRED'},{status:415,headers});
  try{return Response.json(scoreComparatorBatch(module,parseIntegerJson(await boundedBody(request))),{headers});}
  catch(error){const code=error.code??'INVALID_JSON';return Response.json({error:code},{status:code==='BODY_TOO_LARGE'?413:code==='READ_TIMEOUT'?408:400,headers});}
}};}
