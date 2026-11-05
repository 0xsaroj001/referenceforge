import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expandedDescriptor, UNIFIED_ORIGIN } from './render-expanded-miner.mjs';
const origin=process.argv[2]??'http://127.0.0.1:8793';assert(['http://127.0.0.1:8793','http://127.0.0.1:8794',UNIFIED_ORIGIN].includes(origin));
const root=new URL('../',import.meta.url),dir=new URL('reports/intent-expansion/',root),prepared=JSON.parse(await readFile(new URL('prepared.json',dir),'utf8'));
const rows=[],answers=[],sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
async function check(id,path,status,verify,options={}){
  const start=performance.now();let actualStatus,errorCode;
  try{const r=await fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(20000)}),bytes=Buffer.from(await r.arrayBuffer());actualStatus=r.status;assert(bytes.length<2097152);
    let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{}
    errorCode=body?.error?.code;assert.equal(r.status,status);
    await verify?.(body,r,bytes);rows.push({id,pass:true,status:r.status,latency_ms:performance.now()-start});if(id.startsWith('real-'))answers.push({id,path,answer:body});
  }catch(error){rows.push({id,pass:false,status:actualStatus,error_code:errorCode,error:error.message.slice(0,400),latency_ms:performance.now()-start});}
}
for(const x of prepared.preserved)await check('preserved-'+x.file,'/'+x.file,200,(_,__,b)=>assert.equal(sha(b),x.sha256));
for(const x of prepared.outputs)await check('candidate-'+x.file,'/'+x.file,200,(a,r,b)=>{assert.equal(sha(b),x.hash);assert.deepEqual(a,expandedDescriptor({keepFx:x.keepFx}));assert.match(r.headers.get('content-type'),/yaml/);});
await check('seven-capability-health','/health',200,a=>{assert(expandedDescriptor().semantics.supported_intents.every(i=>a.supported_intents.includes(i)));assert(['0.4.0','0.5.0','0.5.1','0.5.2','0.5.3','0.5.4'].includes(a.version));});
for(const path of ['/research/','/reports/state.json','/.env','/sign'])await check('private-absent-'+path,path,404);
for(const path of ['/convert','/tx','/wallet-balance']){
  await check('required-input-'+path,path,422,a=>assert(!Object.hasOwn(a,'score_value')));
  await check('duplicate-input-'+path,path+'?chain=base&chain=base-sepolia',400);
}
await check('no-ENS','/wallet-balance?chain=base&address=vitalik.eth',422);
await check('no-arbitrary-RPC','/tx?chain=base&rpc_url=https://example.com',422);
await check('real-conversion','/convert?base=USD&quote=INR&amount=100',200,a=>{assert.equal(a.intent,'CURRENCY_EXCHANGE');assert.equal(a.score_value,a.converted_amount);assert.notEqual(a.score_value,a.rate);assert.equal(a.amount,'100');assert(a.source.payload_sha256);});
await check('real-legacy-FX','/fx?base=USD&quote=INR',200,a=>{assert.equal(a.intent,'FX_NOW');assert.equal(a.score_value,a.numeric_value);assert.equal(a.frequency,'daily_reference');});
await check('real-legacy-macro','/macro?country=US&indicator=unemployment&year=2019',200,a=>{assert.equal(a.intent,'MACRO_ECONOMIC_INDICATOR');assert.equal(a.observation_year,2019);assert.equal(a.score_value,a.numeric_value);});
const live=JSON.parse(await readFile(new URL('reports/onchain-miner/live-benchmark.json',root),'utf8'));
for(const chain of ['base','base-sepolia']){
  const example=live.rows.find(x=>x.kind==='metric'&&x.params.chain===chain&&x.params.metric==='gas'&&x.http_status===200);
  await new Promise(r=>setTimeout(r,1200));
  await check('real-tx-'+chain,'/tx?'+new URLSearchParams({chain,tx_hash:example.params.tx_hash,field:'gas_used'}),200,a=>{assert.equal(a.intent,'ONCHAIN_TX_LOOKUP');assert.equal(a.score_value,example.answer.score_value);assert.equal(a.receipt.gas_used,a.score_value);assert.equal(a.verification.sources.length,2);});
  await new Promise(r=>setTimeout(r,1200));
  await check('real-wallet-'+chain,'/wallet-balance?'+new URLSearchParams({chain,address:'0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3'}),200,checkWallet);
}
function checkWallet(a){
  assert.equal(a.intent,'WALLET_BALANCE_CHECK');assert.equal(a.score_value,a.balance);assert.equal(a.verified_answer,true);assert.equal(a.requested_block,'current');assert.equal(a.verification.sources.length,2);
  const scale=Number(a.token_decimals),[whole,frac='']=a.balance.split('.');assert(frac.length<=scale);
  const reconstructed=BigInt(whole)*(10n**BigInt(scale))+BigInt((frac.padEnd(scale,'0'))||'0');assert.equal(reconstructed.toString(),a.value_raw);
  assert(a.verification.rpc_cost.http_requests<=16);assert(BigInt(a.tag_resolution.block_age_seconds)<=120n);
}
await new Promise(r=>setTimeout(r,1200));
const erc20=live.rows.find(x=>x.kind==='metric'&&x.params.chain==='base'&&x.params.metric==='erc20_balance'&&x.http_status===200);
await check('real-ERC20-wallet-POST','/wallet-balance',200,a=>{checkWallet(a);assert.equal(a.unit,'token_units');assert.equal(a.token_decimals,'6');},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chain:'base',address:erc20.params.address,token:erc20.params.token})});
const transfer=live.rows.find(x=>x.kind==='transfer'&&x.params.chain==='base'&&x.http_status===200&&x.answer.claim_verified);
await new Promise(r=>setTimeout(r,1200));
await check('real-legacy-transfer','/verify-transfer?'+new URLSearchParams(transfer.params),200,a=>assert.equal(a.score_value,transfer.answer.score_value));
await new Promise(r=>setTimeout(r,1200));
const gas=live.rows.find(x=>x.kind==='metric'&&x.params.chain==='base'&&x.params.metric==='gas'&&x.http_status===200);
await check('real-legacy-metric','/onchain-metric?'+new URLSearchParams(gas.params),200,a=>assert.equal(a.score_value,gas.answer.score_value));
const report={checked_at:new Date().toISOString(),origin,total:rows.length,passed:rows.filter(x=>x.pass).length,rows,answers,scope:'Direct HTTP, old asset hashes and all seven endpoint capabilities. No Telegraph routed request, score, payout, paid provider call or wallet transaction.'};
await mkdir(dir,{recursive:true});const name=(origin===UNIFIED_ORIGIN?'public':'workerd')+'-smoke-'+Date.now()+'.json';await writeFile(new URL(name,dir),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,answers:undefined},null,2));if(report.total!==report.passed)process.exitCode=1;
