import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createOnchainServer } from '../src/onchain-server.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { cases,runCase } from '../test/fixtures/onchain-cases.mjs';
import { fixture,NOW,TX } from '../test/fixtures/onchain.mjs';

const directory=new URL('../reports/onchain-miner/',import.meta.url);await mkdir(directory,{recursive:true});
export const percentiles=values=>{const s=[...values].sort((a,b)=>a-b);return {n:s.length,p50_ms:s[Math.ceil(s.length*.5)-1]??null,p95_ms:s[Math.ceil(s.length*.95)-1]??null,max_ms:s.at(-1)??null};};
const rows=[];
for(const c of cases){const t=performance.now();try{rows.push({...await runCase(c),duration_ms:performance.now()-t});}catch(e){rows.push({id:c.id,family:c.family,pass:false,error:e.message});}}
// Explicitly weak, authored ablation. It is NOT a competitor implementation.
const ablationIds=['native-wrong-recipient','token-wrong-outer-recipient','predicates-must-match-one-event','wrong-token-event','transaction-value-disagreement','fee-disagreement','wrong-rpc-chain','wrong-receipt-tx','wrong-receipt-block','providers-disagree-on-block','stale-rpc-head','insufficient-l2-confirmations'];
const ablation=[];
for(const id of ablationIds){const c=cases.find(x=>x.id===id),f=fixture(c.options);ablation.push({id,expected_transfer_verified:false,receipt_status_only_accepts:f.receipt.status==='0x1',current_false_accept:rows.find(x=>x.id===id)?.pass!==true});}
const f=fixture(),server=createOnchainServer({miner:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW})});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const timings=[],statuses={};
try {
  for(let batch=0;batch<25;batch++)await Promise.all(Array.from({length:8},async()=>{const t=performance.now();const r=await fetch(origin+`/verify-transfer?chain=base-sepolia&asset=native&tx_hash=${TX}`);const a=await r.json();timings.push(performance.now()-t);statuses[r.status]=(statuses[r.status]??0)+1;assert.equal(a.claim_verified,true);}));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
const report={checked_at:new Date().toISOString(),scope:'Authored development and injected-fault cases, not held-out accuracy or a competitor benchmark',correctness:{total:rows.length,passed:rows.filter(x=>x.pass).length,families:[...new Set(rows.map(x=>x.family))],rows},false_confirmation_ablation:{description:'Receipt-status-only decision versus full expectation, source, block and confirmation checks on 12 chosen negative cases',cases:ablation,status_only_false_accepts:ablation.filter(x=>x.receipt_status_only_accepts).length,current_false_accepts:ablation.filter(x=>x.current_false_accept).length},http_fixture_load:{requests:timings.length,concurrency:8,statuses,latency:percentiles(timings),rpc_http_requests:f.calls.length,cache_used:false,scope:'Loopback HTTP and synthetic RPC transport. Not deployed latency, free-RPC capacity, production uptime or Worker CPU.'}};
await writeFile(new URL('development-benchmark.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({correctness:{passed:report.correctness.passed,total:rows.length},false_confirmation_ablation:{status_only:report.false_confirmation_ablation.status_only_false_accepts,current:report.false_confirmation_ablation.current_false_accepts},http_fixture_load:report.http_fixture_load},null,2));
assert.equal(report.correctness.passed,rows.length);assert.equal(report.false_confirmation_ablation.current_false_accepts,0);
