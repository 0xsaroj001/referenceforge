import { mkdir,writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { NETWORKS } from '../src/onchain/input.mjs';
import { boundedText } from '../src/onchain/rpc.mjs';
import { TRANSFER_TOPIC } from '../src/onchain/verify.mjs';

const dir=new URL('../reports/onchain-miner/',import.meta.url);await mkdir(dir,{recursive:true});
const hex=n=>'0x'+BigInt(n).toString(16);
const stats=xs=>{const s=[...xs].sort((a,b)=>a-b);return {n:s.length,p50_ms:s[Math.ceil(s.length*.5)-1]??null,p95_ms:s[Math.ceil(s.length*.95)-1]??null,max_ms:s.at(-1)??null};};
let discoveryRequests=0;
async function source(chain,calls) {
  if(calls.length>5){const out=[];for(let i=0;i<calls.length;i+=5)out.push(...await source(chain,calls.slice(i,i+5)));return out;}
  discoveryRequests++;
  const signal=AbortSignal.timeout(8000),r=await fetch(NETWORKS[chain].providers[0].url,{method:'POST',headers:{'content-type':'application/json'},redirect:'manual',body:JSON.stringify(calls.map((x,i)=>({jsonrpc:'2.0',id:i+1,method:x.method,params:x.params??[]}))),signal});
  if(!r.ok)throw new Error('Reference RPC HTTP '+r.status);
  const text=await boundedText(r,4194304,signal),j=JSON.parse(text);
  if(!Array.isArray(j)||j.length!==calls.length||j.some(x=>x.error))throw new Error('Reference RPC rejected a read-only capture: '+JSON.stringify({methods:calls.map(x=>x.method),error:j.error??j.find?.(x=>x.error)?.error??'batch shape'}));
  return calls.map((_,i)=>j.find(x=>x.id===i+1).result);
}
const capture=[],liveCases=[];
for(const chain of Object.keys(NETWORKS)) {
  const [rawHead]=await source(chain,[{method:'eth_getBlockByNumber',params:['latest',false]}]);
  let nativeFound=false,tokenFound=false,revertFound=false;
  for(let offset=40n;offset<44n;offset++) {
    const [block]=await source(chain,[{method:'eth_getBlockByNumber',params:[hex(BigInt(rawHead.number)-offset),true]}]);
    const candidates=block.transactions.filter(t=>['0x0','0x1','0x2','0x3','0x4'].includes(t.type)&&t.to).slice(0,18);
    if(!candidates.length)continue;
    const receipts=await source(chain,candidates.map(t=>({method:'eth_getTransactionReceipt',params:[t.hash]})));
    for(let i=0;i<candidates.length;i++) {
      const tx=candidates[i],receipt=receipts[i];if(!receipt)continue;
      capture.push({chain,tx,receipt,block:{number:block.number,hash:block.hash,timestamp:block.timestamp,baseFeePerGas:block.baseFeePerGas}});
      if(!nativeFound&&receipt.status==='0x1'&&BigInt(tx.value)>0n){nativeFound=true;liveCases.push({id:chain+'-native-transfer',kind:'transfer',params:{chain,tx_hash:tx.hash,asset:'native',expected_from:tx.from,expected_to:tx.to,expected_amount:BigInt(tx.value).toString()}});}
      const event=receipt.logs.find(l=>l.topics?.[0]===TRANSFER_TOPIC&&l.topics.length===3&&l.data.length===66);
      if(!tokenFound&&receipt.status==='0x1'&&event){tokenFound=true;liveCases.push({id:chain+'-token-transfer',kind:'transfer',params:{chain,tx_hash:tx.hash,asset:'erc20',token:event.address,expected_from:'0x'+event.topics[1].slice(-40),expected_to:'0x'+event.topics[2].slice(-40),expected_amount:BigInt(event.data).toString()}});liveCases.push({id:chain+'-token-balance',kind:'metric',params:{chain,metric:'erc20_balance',address:'0x'+event.topics[2].slice(-40),token:event.address,block:block.number}});}
      if(!revertFound&&receipt.status==='0x0'){revertFound=true;liveCases.push({id:chain+'-reverted',kind:'transfer',params:{chain,tx_hash:tx.hash,asset:'native'}});}
    }
    if(tokenFound&&(nativeFound||chain==='base-sepolia')&&revertFound)break;
    // Discovery is bounded. Missing live states are reported, not manufactured.
    if(offset>=41n&&tokenFound&&(nativeFound||chain==='base-sepolia'))break;
  }
  const first=capture.find(x=>x.chain===chain);
  if(first) {
    liveCases.push({id:chain+'-native-balance',kind:'metric',params:{chain,metric:'native_balance',address:first.tx.from,block:first.block.number}});
    for(const block of ['safe','finalized'])liveCases.push({id:chain+'-'+block+'-balance',kind:'metric',params:{chain,metric:'native_balance',address:first.tx.from,block}});
    for(const metric of ['transaction','gas','logs'])liveCases.push({id:chain+'-'+metric,kind:'metric',params:{chain,metric,tx_hash:first.tx.hash}});
  }
}
await writeFile(new URL('live-reference-captures.json',dir),JSON.stringify({captured_at:new Date().toISOString(),scope:'Configured primary RPC captures, not independent truth; oracle decoding is separate',capture},null,2)+'\n');
// A fresh verifier process has no discovery connection pool and no result cache.
const serverCode="import {createOnchainServer} from './src/onchain-server.mjs';const s=createOnchainServer();s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));";
const child=spawn(process.execPath,['--input-type=module','-e',serverCode],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',x=>{stderr+=x.toString().slice(0,500);});
const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Local benchmark server startup timeout')),10000);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Local benchmark server exited'));});child.stdout.on('data',x=>{text+=x;const end=text.indexOf('\n');if(end>=0){clearTimeout(timer);try{resolve(JSON.parse(text.slice(0,end)).port);}catch{reject(new Error('Invalid local server announcement'));}}});});
const rows=[];
try {
  for(let round=0;round<3;round++)for(const c of liveCases) {
    const url=new URL(c.kind==='transfer'?'/verify-transfer':'/onchain-metric',`http://127.0.0.1:${port}`);url.search=new URLSearchParams(c.params);
    const start=performance.now(),r=await fetch(url,{signal:AbortSignal.timeout(8000)}),answer=await r.json(),ms=performance.now()-start;
    const reference=c.params.tx_hash?capture.find(x=>x.chain===c.params.chain&&x.tx.hash.toLowerCase()===c.params.tx_hash.toLowerCase()):null;
    let stateReference=null;
    if(!c.params.tx_hash&&r.ok){
      const ref={blockHash:answer.block.hash,requireCanonical:true};
      const [raw]=await source(c.params.chain,[c.params.metric==='native_balance'?{method:'eth_getBalance',params:[c.params.address,ref]}:{method:'eth_call',params:[{to:c.params.token,data:'0x70a08231'+c.params.address.slice(2).padStart(64,'0')},ref]}]);
      stateReference=raw;
    }
    const row={id:c.id,kind:c.kind,round,temperature:round===0?'first_per_case':'repeat_fresh_rpc',params:c.params,http_status:r.status,latency_ms:ms,target_ms:c.kind==='transfer'?1500:2000,within_latency_target:ms<(c.kind==='transfer'?1500:2000),answer,reference,state_reference:stateReference};rows.push(row);
  }
}finally{child.kill();}
const summary={checked_at:new Date().toISOString(),cache_used:false,broadcasts:0,discovery_reference_http_requests:discoveryRequests,scope:'Local HTTP service with real Base and PublicNode reads. One fresh verifier process; first process request includes connection setup, repeats still perform all RPC checks. Not a deployed edge, sustained uptime, network admission or competitor test.',discovered_case_ids:liveCases.map(x=>x.id),live_states_missing:['base','base-sepolia'].filter(chain=>!liveCases.some(x=>x.id===chain+'-reverted')).map(chain=>chain+': no reverted transaction found within discovery budget'),by_intent:Object.fromEntries(['transfer','metric'].map(kind=>{const rs=rows.filter(x=>x.kind===kind);return [kind,{...stats(rs.map(x=>x.latency_ms)),http_successes:rs.filter(x=>x.http_status===200).length,latency_target_passes:rs.filter(x=>x.http_status===200&&x.within_latency_target).length,first_per_case:stats(rs.filter(x=>x.round===0).map(x=>x.latency_ms)),repeat_fresh_rpc:stats(rs.filter(x=>x.round>0).map(x=>x.latency_ms))}];})),rows};
await writeFile(new URL('live-benchmark.json',dir),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({by_intent:summary.by_intent,live_states_missing:summary.live_states_missing,discovery_reference_http_requests:discoveryRequests,samples:rows.length,stderr:stderr||null},null,2));
if(rows.some(x=>x.http_status!==200||!x.within_latency_target))process.exitCode=2;
