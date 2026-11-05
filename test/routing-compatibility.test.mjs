import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMetric,parseWallet} from '../src/onchain/input.mjs';
import {createOnchainMiner} from '../src/onchain/verify.mjs';
import {createUnifiedHandler} from '../src/unified.mjs';
import {fixture,NOW,A,TX} from './fixtures/onchain.mjs';
import {classifyScore} from '../tools/lib/score-diagnostics.mjs';
const setup=options=>{const f=fixture(options);return {...f,miner:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW})};};

test('Base names and chain IDs normalize explicitly without changing network identity',()=>{
 for(const chain of ['base','BASE','Base Mainnet','base_mainnet','8453',8453,'0x2105'])assert.equal(parseMetric({chain,metric:'native_balance',address:A}).chain,'base');
 for(const chain of ['base-sepolia','Base Sepolia','base_sepolia','84532',84532,'0x14a34'])assert.equal(parseWallet({chain,address:A}).chain,'base-sepolia');
 for(const chain of ['ethereum','ETH','mainnet',1,'0x1','arbitrum',null,{},'base-sepolia-mainnet'])assert.throws(()=>parseWallet({chain,address:A}),{code:'UNSUPPORTED_CHAIN'});
});
test('lookup accepts equivalent field spellings and returns canonical field plus explicit units',async()=>{
 for(const [field,canonical,unit]of [['gasUsed','gas_used','gas'],['blockNumber','block_number','block_number'],['transaction status','status','execution_status'],['sender','from','address'],['recipient','to','address'],['native_value_wei','value_wei','wei']]){const f=setup(),a=await f.miner.lookup({chain:'Base Sepolia',tx_hash:TX,field});assert.equal(a.field,canonical);assert.equal(a.unit,unit);assert.equal(a.verified_answer,true);assert.equal(typeof a.score_value,'string');}
});
test('new primary transaction fields use existing jointly verified evidence, including zeros and component fees',async()=>{
 for(const [field,key,unit]of [['confirmations','confirmations_l2','L2_blocks'],['nonce','nonce','nonce'],['log_count','log_count','logs'],['gas_price_wei','effective_gas_price_wei','wei_per_gas'],['execution_fee_wei','execution_fee_wei','wei'],['l1_data_fee_wei','l1_data_fee_wei','wei']]){const f=setup(),a=await f.miner.lookup({chain:'base-sepolia',tx_hash:TX,field});const expected=key==='confirmations_l2'?a.confirmations_l2:key==='log_count'?String(a.receipt.logs.length):key==='nonce'?a.transaction.nonce:a.fees[key];assert.equal(a.score_value,expected);assert.equal(a.unit,unit);assert.equal(a.verified_answer,true);assert.equal(a.fees.total_fee_wei,null);}
});
test('pending, unknown and absent fee components stay inconclusive instead of becoming zero or complete fees',async()=>{
 for(const state of ['pending','unknown'])for(const field of ['confirmations','nonce','log_count','execution_fee_wei']){const a=await setup({state}).miner.lookup({chain:'base-sepolia',tx_hash:TX,field});assert.equal(a.score_value,null);assert.equal(a.verified_answer,false);}
 const f=setup({mutate:x=>{if(x.method!=='eth_getTransactionReceipt'||!x.result)return x.result;const r={...x.result};delete r.l1Fee;return r;}}),a=await f.miner.lookup({chain:'base-sepolia',tx_hash:TX,field:'l1_data_fee_wei'});assert.equal(a.score_value,null);assert.equal(a.fulfillment,'inconclusive');
 for(const field of ['value','amount','gas_price','total_fee','total_fee_wei','trace']){const f=setup();await assert.rejects(f.miner.lookup({chain:'base-sepolia',tx_hash:TX,field}),{code:'UNSUPPORTED_FIELD'});assert.equal(f.calls.length,0);}
});
test('HTTP transaction mappings retain units and scalar selection under routing aliases',async()=>{
 const f=setup(),h=createUnifiedHandler({expanded:true,onchain:f.miner});const r=await h(new Request('https://test/tx?'+new URLSearchParams({chain:'Base Sepolia',tx_hash:TX,field:'gasUsed'}))),a=await r.json();assert.equal(r.status,200);assert.equal(a.score_value,'21000');assert.equal(a.unit,'gas');assert.equal(a.intent,'ONCHAIN_TX_LOOKUP');
});
test('failure diagnostics distinguish coverage refusals, platform construction failures and source outages',()=>{
 for(const [failure_reason,expected]of [['call miner 422 [UNSUPPORTED_CHAIN]','unsupported_chain'],['call miner 422 [UNSUPPORTED_LOCATION]','unsupported_location'],['call miner 422 [UNSUPPORTED_FIELD]','unsupported_lookup_field'],['build request: LLM API error 429 RESOURCE_EXHAUSTED','platform_request_builder_quota'],['build request: http request: server closed idle connection','platform_request_builder_transport'],['call miner 503 [RPC_UNAVAILABLE]','rpc_availability'],['call miner 503 [SOURCE_UNAVAILABLE]','source_availability'],['','zero_score_without_public_failure']])assert.equal(classifyScore({score:0,failure_reason}),expected);
 assert.equal(classifyScore({score:0.0000002,failure_reason:''}),'scored_positive');
});
