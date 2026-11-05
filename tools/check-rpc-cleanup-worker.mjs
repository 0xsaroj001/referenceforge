// Local workerd regression only. No upstream fetches, resources or deployment.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const source=`import {boundedText} from './src/onchain/rpc.mjs';
export default {async fetch(request){
 const oversized=new URL(request.url).pathname==='/oversize';let cancelled=false;
 const stream=new ReadableStream({start(controller){if(oversized)controller.enqueue(new Uint8Array(12));},cancel(){cancelled=true;return new Promise(()=>{});}});
 const response=new Response(stream);let error=null;
 try{await boundedText(response,10,oversized?undefined:AbortSignal.timeout(25));}catch(e){error=e.message;}
 return Response.json({error,cancelled,locked:response.body.locked});
}};`;
const output=await build({stdin:{contents:source,resolveDir:resolve(import.meta.dirname,'..'),sourcefile:'rpc-cleanup-runtime.mjs'},bundle:true,write:false,format:'esm',platform:'browser'});
// Locked Miniflare 5 uses workers[].config.manifest, unlike its older README.
const worker=new Miniflare({workers:[{config:{name:'rpc-cleanup-local',compatibilityDate:'2026-10-23',manifest:{mainModule:'fixture.mjs',modules:{'fixture.mjs':{type:'esm',contents:output.outputFiles[0].text}}}}}]}),checks=[];
try{for(const path of ['/deadline','/oversize']){
 let timer;const start=performance.now();
 try{const response=await Promise.race([worker.dispatchFetch('http://local.test'+path),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Local Worker test timeout')),3000);})]);const result=await response.json();assert.equal(response.status,200);assert.equal(result.error,path==='/deadline'?'deadline':'response too large');assert.equal(result.cancelled,true);assert.equal(result.locked,false);checks.push({path,...result,elapsed_ms:Math.round(performance.now()-start)});}finally{clearTimeout(timer);}
}}finally{await worker.dispose();}
const report={checked_at:new Date().toISOString(),runtime:'Local workerd via locked Miniflare/esbuild',compatibility_date:'2026-10-23',checks,network_calls:0,uploaded:false};
await mkdir('reports/v2-rpc/cleanup',{recursive:true});await writeFile('reports/v2-rpc/cleanup/worker-runtime.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
