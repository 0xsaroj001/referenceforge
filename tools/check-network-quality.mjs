import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {classifyScore} from './lib/score-diagnostics.mjs';
const mode=process.argv[2]??'--check';assert(['--check','--probe-payment-gate'].includes(mode));await mkdir('reports/network-quality',{recursive:true});
async function json(url,options={}){const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)}),text=await r.text();assert(text.length<3000000);let body;try{body=JSON.parse(text);}catch{}return {status:r.status,body};}
const catalogue=await json('https://devnode.telegraphprotocol.com/api/miners?status=active&limit=2000'),miner=catalogue.body?.find(x=>x.slug==='referenceforge-numeric'&&x.wallet_address?.toLowerCase()==='0xfec66e0f5c64296ff190edced88c781eeedfd9d3');assert(miner?.activation_status==='active');
const history=await json('https://explorer.telegraphprotocol.com/api/scores?miner=referenceforge-numeric&limit=100&offset=0');assert(Array.isArray(history.body?.scores));
const latest=new Map();for(const s of history.body.scores){const old=latest.get(s.intent_id);if(!old||Date.parse(s.scored_at)>Date.parse(old.scored_at))latest.set(s.intent_id,s);}
const report={checked_at:new Date().toISOString(),miner_id:miner.id,active:true,registered_intents:miner.supported_intents,requests:miner.total_requests_served,latest_scores:[...latest.values()].map(s=>({intent:s.intent_id,epoch:s.epoch_id,rank:s.rank,score:s.score,classification:classifyScore(s),scored_at:s.scored_at})),unscored_intents:miner.supported_intents.filter(i=>!latest.has(i)),payment_probe:null,scope:'Public read-only registry/score history. Score classifications are based on recorded errors, not private request payloads. No scorer changes, ranking manipulation, paid calls, signatures or payment authorization.'};
if(mode==='--probe-payment-gate'){
  // One structured request without payment or account headers. Never pay/retry.
  const payload={method:'GET',endpoint:'/onchain-metric',payload:{chain:'base',metric:'native_balance',address:miner.wallet_address}};
  const r=await json('https://devnode.telegraphprotocol.com/engine/v1/ask/'+encodeURIComponent(miner.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  await writeFile('reports/network-quality/unpaid-engine-probe.json',JSON.stringify({checked_at:new Date().toISOString(),request:payload,...r},null,2)+'\n');report.payment_probe={http_status:r.status,paid:false,retried:false,signer_used:false,meaning:r.status===402?'Payment gate reached; inference/routing not executed or verified':r.status===200?'Unpaid direct Engine inference returned; not independent adoption':'Request did not verify usable inference'};
}
await writeFile('reports/network-quality/status.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
