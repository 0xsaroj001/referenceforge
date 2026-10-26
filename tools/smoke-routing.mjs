import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.argv[2]??'http://127.0.0.1:8794';assert(['http://127.0.0.1:8794','https://referenceforge.0xsaroj001.workers.dev'].includes(origin));
const live=JSON.parse(await readFile('reports/onchain-miner/live-benchmark.json','utf8'));
const gas=live.rows.find(x=>x.kind==='metric'&&x.params.chain==='base'&&x.params.metric==='gas'&&x.http_status===200),erc=live.rows.find(x=>x.kind==='metric'&&x.params.chain==='base'&&x.params.metric==='erc20_balance'&&x.http_status===200);
const rows=[];
for(const [alias,params] of [['native-balance',{chain:'base',address:'0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3'}],['erc20-balance',{chain:'base',address:erc.params.address,token:erc.params.token}],...['transaction','gas','logs'].map(x=>[x,{chain:'base',tx_hash:gas.params.tx_hash}])]){
  const path='/onchain-metric/'+alias,start=performance.now();
  try{const r=await fetch(origin+path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(15000)}),a=await r.json();assert.equal(r.status,200);assert.equal(a.intent,'ONCHAIN_METRIC_VERIFY');assert(a.verification?.sources?.length===2);assert.equal(typeof a.score_value,'string');rows.push({path,pass:true,latency_ms:Math.round(performance.now()-start),score_value:a.score_value});}catch(e){rows.push({path,pass:false,error:e.message.slice(0,250)});}
  const missing=await fetch(origin+path+'?chain=base');const a=await missing.json();rows.push({path:alias+'-missing',pass:missing.status===422&&a.error?.code==='MISSING_PARAMETER'});
}
const report={checked_at:new Date().toISOString(),origin,passed:rows.filter(x=>x.pass).length,total:rows.length,rows,scope:'Direct HTTP for original explicit metric routes. Does not establish node routing, scoring improvement, payment or independent adoption.'};await writeFile('reports/network-quality/'+(origin.startsWith('http://127')?'workerd':'public')+'-routing-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
