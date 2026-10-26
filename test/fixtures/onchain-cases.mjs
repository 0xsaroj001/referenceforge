import assert from 'node:assert/strict';
import { createOnchainMiner } from '../../src/onchain/verify.mjs';
import { A,B,TOKEN,OTHER,TX,BLOCK,BAD,NOW,HEX,event,fixture } from './onchain.mjs';

const native={chain:'base-sepolia',tx_hash:TX,asset:'native'};
const erc20={chain:'base-sepolia',tx_hash:TX,asset:'erc20',token:TOKEN};
const balance={chain:'base-sepolia',metric:'native_balance',address:A};
const alteration=(method,change,provider=1)=>({mutate:x=>x.method===method&&x.index===provider?change(x.result,x):x.result});
export const cases=[
  {id:'native-large-integer',family:'transfer_amount',method:'transfer',params:{...native,expected_to:TOKEN,expected_amount:'123456789012345678901234567890'},check:a=>{assert.equal(a.claim_verified,true);assert.equal(a.transfers[0].amount_raw,'123456789012345678901234567890');assert.equal(a.fees.execution_fee_wei,'2100000');assert.equal(a.fees.total_fee_wei,null);}},
  {id:'native-wrong-recipient',family:'transfer_predicate',method:'transfer',params:{...native,expected_to:B},check:a=>assert.equal(a.claim_verified,false)},
  {id:'native-zero-no-movement',family:'transfer_predicate',method:'transfer',params:native,options:{mutate:x=>x.method==='eth_getTransactionByHash'?{...x.result,value:'0x0'}:x.result},check:a=>assert.equal(a.claim_verified,false)},
  {id:'token-recipient-not-tx-recipient',family:'token_event',method:'transfer',params:{...erc20,expected_to:B,expected_amount:'3000000'},check:a=>{assert.equal(a.claim_verified,true);assert.equal(a.transaction.to,TOKEN);assert.equal(a.transfers[0].to,B);}},
  {id:'token-wrong-outer-recipient',family:'token_event',method:'transfer',params:{...erc20,expected_to:TOKEN},check:a=>assert.equal(a.claim_verified,false)},
  {id:'predicates-must-match-one-event',family:'token_event',method:'transfer',params:{...erc20,expected_from:A,expected_to:B,expected_amount:'7'},options:{logs:[event(A,OTHER,'7',0),event(OTHER,B,'7',1)]},check:a=>assert.equal(a.claim_verified,false)},
  {id:'wrong-token-event',family:'token_event',method:'transfer',params:erc20,options:{logs:[event(A,B,'3000000',0,OTHER)]},check:a=>assert.equal(a.claim_verified,false)},
  {id:'large-token-event-amount',family:'transfer_amount',method:'transfer',params:{...erc20,expected_amount:'1606938044258990275541962092341162602522202993782792835301376'},options:{logs:[event(A,B,'1606938044258990275541962092341162602522202993782792835301376')]},check:a=>assert.equal(a.claim_verified,true)},
  {id:'reverted-not-transfer',family:'execution_state',method:'transfer',params:native,options:{state:'reverted'},check:a=>{assert.equal(a.state,'reverted');assert.equal(a.claim_verified,false);assert.equal(a.score_value,'0');assert.equal(a.fees.execution_fee_wei,'2100000');}},
  ...['pending','unknown'].map(state=>({id:state+'-not-confirmed',family:'execution_state',method:'transfer',params:native,options:{state},check:a=>{assert.equal(a.state,state);assert.equal(a.verified_answer,false);assert.equal(a.claim_verified,false);assert.equal(a.score_value,null);}})),
  {id:'insufficient-l2-confirmations',family:'confirmation_scope',method:'transfer',params:{...native,min_confirmations:'102'},check:a=>{assert.equal(a.confirmations_l2,'101');assert.equal(a.claim_verified,false);assert.equal(a.fulfillment,'inconclusive');}} ,
  {id:'pending-source-disagreement',family:'provider_disagreement',method:'transfer',params:native,options:alteration('eth_getTransactionReceipt',()=>null),error:'RPC_DISAGREEMENT'},
  {id:'transaction-value-disagreement',family:'provider_disagreement',method:'transfer',params:native,options:alteration('eth_getTransactionByHash',x=>({...x,value:'0x1'})),error:'RPC_DISAGREEMENT'},
  {id:'fee-disagreement',family:'provider_disagreement',method:'transfer',params:native,options:alteration('eth_getTransactionReceipt',x=>({...x,effectiveGasPrice:'0x65'})),error:'RPC_DISAGREEMENT'},
  {id:'wrong-rpc-chain',family:'identity',method:'transfer',params:native,options:alteration('eth_chainId',()=> '0x1'),error:'WRONG_RPC_CHAIN'},
  {id:'wrong-transaction-chain',family:'identity',method:'transfer',params:native,options:alteration('eth_getTransactionByHash',x=>({...x,chainId:'0x1'})),error:'INVALID_RPC_DATA'},
  {id:'wrong-receipt-tx',family:'identity',method:'transfer',params:native,options:alteration('eth_getTransactionReceipt',x=>({...x,transactionHash:BAD})),error:'INVALID_RPC_DATA'},
  {id:'wrong-receipt-block',family:'reorg',method:'transfer',params:native,options:{mutate:x=>x.method==='eth_getBlockByNumber'&&x.params[0]!=='latest'?{...x.result,hash:BAD}:x.result},error:'REORG_DETECTED'},
  {id:'providers-disagree-on-block',family:'reorg',method:'transfer',params:native,options:alteration('eth_getBlockByNumber',(r,x)=>x.params[0]==='latest'?r:{...r,hash:BAD}),error:'REORG_OR_BLOCK_DISAGREEMENT'},
  {id:'stale-rpc-head',family:'freshness',method:'transfer',params:native,options:alteration('eth_getBlockByNumber',x=>({...x,timestamp:HEX(NOW/1000-121)})),error:'STALE_RPC_HEAD'},
  {id:'future-rpc-head',family:'freshness',method:'transfer',params:native,options:alteration('eth_getBlockByNumber',x=>({...x,timestamp:HEX(NOW/1000+11)})),error:'STALE_RPC_HEAD'},
  {id:'large-head-skew',family:'freshness',method:'transfer',params:native,options:alteration('eth_getBlockByNumber',(r,x)=>x.params[0]==='latest'?{...r,number:HEX(1005)}:r),error:'RPC_HEAD_DIVERGENCE'},
  {id:'conservative-confirmations',family:'confirmation_scope',method:'transfer',params:{...native,min_confirmations:'101'},options:alteration('eth_getBlockByNumber',(r,x)=>x.params[0]==='latest'?{...r,number:HEX(999)}:r),check:a=>{assert.equal(a.confirmations_l2,'100');assert.equal(a.claim_verified,false);}},
  {id:'same-height-common-head-fork',family:'reorg',method:'transfer',params:native,options:alteration('eth_getBlockByNumber',(r,x)=>x.params[0]===HEX(1000)?{...r,hash:BAD}:r),error:'RPC_HEAD_DISAGREEMENT'},
  {id:'malformed-nft-event',family:'token_event',method:'transfer',params:erc20,options:{logs:[{...event(),topics:[...event().topics,BLOCK]}]},error:'INVALID_RPC_DATA'},
  {id:'removed-log',family:'reorg',method:'transfer',params:erc20,options:{logs:[{...event(),removed:true}]},error:'INVALID_RPC_DATA'},
  {id:'duplicate-log-index',family:'event_integrity',method:'transfer',params:erc20,options:{logs:[event(),event()]},error:'INVALID_RPC_DATA'},
  {id:'wrong-event-transaction',family:'event_integrity',method:'transfer',params:erc20,options:{logs:[{...event(),transactionHash:BAD}]},error:'INVALID_RPC_DATA'},
  {id:'native-balance-exact',family:'balance_precision',method:'metric',params:balance,check:(a,f)=>{assert.equal(a.value_raw,'900719925474099312345');assert.equal(a.block.hash,BLOCK);assert(f.calls.some(c=>c.params.some(p=>p[1]?.blockHash===BLOCK&&p[1].requireCanonical)));}},
  {id:'advancing-finalized-tags-use-common-ancestor',family:'canonical_state',method:'metric',params:{...balance,block:'finalized'},options:alteration('eth_getBlockByNumber',(r,x)=>x.params[0]==='finalized'?x.header(850n):r),check:a=>{assert.equal(a.block.number,'850');assert.deepEqual(a.tag_resolution.reported_heights,['900','850']);assert.equal(a.tag_resolution.height_difference,'50');}},
  {id:'tag-above-provider-head-is-invalid',family:'canonical_state',method:'metric',params:balance,options:alteration('eth_getBlockByNumber',(r,x)=>x.params[0]==='safe'?x.header(2000n):r),error:'INVALID_RPC_DATA'},
  {id:'inconclusive-confirmations-have-no-score',family:'confirmation_scope',method:'transfer',params:{...native,min_confirmations:'102'},check:a=>{assert.equal(a.verified_answer,false);assert.equal(a.score_value,null);}},
  {id:'token-balance-exact',family:'balance_precision',method:'metric',params:{...balance,metric:'erc20_balance',token:TOKEN},check:a=>assert.equal(a.value_raw,'1606938044258990275541962092341162602522202993782792835301499')},
  {id:'zero-is-valid-balance',family:'balance_precision',method:'metric',params:balance,options:{mutate:x=>x.method==='eth_getBalance'?'0x0':x.result},check:a=>assert.equal(a.value_raw,'0')},
  {id:'balance-disagreement',family:'provider_disagreement',method:'metric',params:balance,options:alteration('eth_getBalance',()=> '0x1'),error:'RPC_DISAGREEMENT'},
  {id:'no-contract-token',family:'contract_scope',method:'metric',params:{...balance,metric:'erc20_balance',token:TOKEN},options:{mutate:x=>x.method==='eth_getCode'?'0x':x.result},error:'NOT_A_CONTRACT'},
  {id:'nonstandard-token-return',family:'contract_scope',method:'metric',params:{...balance,metric:'erc20_balance',token:TOKEN},options:{mutate:x=>x.method==='eth_call'?'0x01':x.result},error:'INVALID_RPC_DATA'},
  {id:'unsupported-eip1898-no-fallback',family:'canonical_state',method:'metric',params:balance,options:{transport:({rows,calls})=>new Response(JSON.stringify(rows.map(x=>calls.at(-1).methods.includes('eth_getBalance')?{...x,error:{code:-32602}}:x)))},error:'RPC_UNAVAILABLE'},
  {id:'post-read-reorg',family:'canonical_state',method:'metric',params:balance,options:{mutate:x=>x.method==='eth_getBlockByNumber'&&x.params[0]===HEX(900)?{...x.result,hash:BAD}:x.result},error:'REORG_DETECTED'},
  {id:'archive-unavailable',family:'canonical_state',method:'metric',params:{...balance,block:'100'},options:{mutate:x=>x.method==='eth_getBlockByNumber'&&x.params[0]==='0x64'?null:x.result},error:'BLOCK_UNAVAILABLE'},
  {id:'gas-used-not-gas-price',family:'metric_semantics',method:'metric',params:{chain:'base-sepolia',metric:'gas',tx_hash:TX},check:a=>{assert.equal(a.score_value,'21000');assert.equal(a.value.effective_gas_price_wei,'100');}},
  {id:'receipt-logs-preserved',family:'metric_semantics',method:'metric',params:{chain:'base-sepolia',metric:'logs',tx_hash:TX},check:a=>{assert.equal(a.value.length,1);assert.equal(a.value[0].address,TOKEN);}},
  {id:'reverted-status-is-zero',family:'metric_semantics',method:'metric',params:{chain:'base-sepolia',metric:'transaction',tx_hash:TX},options:{state:'reverted'},check:a=>assert.equal(a.score_value,'0')},
  ...[['unsupported-chain',{...native,chain:'solana'},'UNSUPPORTED_CHAIN'],['unsafe-number-amount',{...native,expected_amount:9007199254740992},'INVALID_INTEGER'],['negative-amount',{...native,expected_amount:'-1'},'INVALID_INTEGER'],['unknown-rpc-url',{...native,rpc_url:'http://127.0.0.1'},'UNSUPPORTED_PARAMETER'],['bad-hash',{...native,tx_hash:'0x123'},'INVALID_HASH'],['token-required',{...erc20,token:undefined},'INVALID_ADDRESS'],['internal-transfer-scope',{...native,asset:'internal'},'UNSUPPORTED_ASSET']].map(([id,params,error])=>({id,family:'input_scope',method:'transfer',params,error,no_io:true})),
  ...['latest','pending','-1','0x00','1.5'].map(block=>({id:'invalid-state-block-'+block,family:'input_scope',method:'metric',params:{...balance,block},error:'INVALID_BLOCK',no_io:true})),
  {id:'rpc-http-429',family:'transport',method:'transfer',params:native,options:{transport:()=>new Response('limited',{status:429})},error:'RPC_UNAVAILABLE'},
  {id:'malformed-rpc-body',family:'transport',method:'transfer',params:native,options:{transport:()=>new Response('{')},error:'RPC_UNAVAILABLE'},
  {id:'duplicate-rpc-id',family:'transport',method:'transfer',params:native,options:{transport:({rows})=>new Response(JSON.stringify(rows.map(x=>({...x,id:1}))))},error:'RPC_UNAVAILABLE'},
  {id:'provider-error-object',family:'transport',method:'transfer',params:native,options:{transport:({rows})=>new Response(JSON.stringify(rows.map(x=>({...x,error:{code:-32000,message:'secret must not escape'}}))))},error:'RPC_UNAVAILABLE'},
  {id:'bounded-rpc-body',family:'transport',method:'transfer',params:native,options:{transport:()=>new Response(' '.repeat(2097153))},error:'RPC_UNAVAILABLE'},
  {id:'one-rpc-timeout-no-fallback',family:'transport',method:'transfer',params:native,options:{transport:({index,rows,options})=>index===0?new Response(JSON.stringify(rows)):new Promise((_,reject)=>{const hold=setTimeout(()=>reject(new Error('fixture timeout')),1000);options.signal.addEventListener('abort',()=>{clearTimeout(hold);reject(new Error('deadline'));},{once:true});})},rpcTimeoutMs:20,error:'RPC_UNAVAILABLE'},
  {id:'unsupported-deposit-fees',family:'fee_scope',method:'transfer',params:native,options:{mutate:x=>x.method==='eth_getTransactionByHash'?{...x.result,type:'0x7e'}:x.result},error:'UNSUPPORTED_TRANSACTION_TYPE'}
];
export async function runCase(c) {
  const f=fixture(c.options),miner=createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW,rpcTimeoutMs:c.rpcTimeoutMs??1000});
  let answer,error;
  try {answer=await miner[c.method](c.params);}catch(e){error=e;}
  if(c.error)assert.equal(error?.code,c.error,c.id+': '+(error?.message??'unexpected success'));
  else {if(error)throw error;c.check(answer,f);}
  if(c.no_io)assert.equal(f.calls.length,0,'Invalid input must fail before RPC');
  assert(f.calls.every(x=>x.methods.every(m=>!m.includes('send')&&!m.includes('sign'))));
  return {id:c.id,family:c.family,pass:true,...(error?{error:error.code}:{state:answer.state??'state_value',claim_verified:answer.claim_verified??null})};
}
