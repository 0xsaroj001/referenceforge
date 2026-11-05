import test from 'node:test';import assert from 'node:assert/strict';
import {assessTxPair,eventWindow} from '../tools/lib/provider-tx-acceptance.mjs';
const h=n=>'0x'+n.repeat(64),a=n=>'0x'+n.repeat(40);
function fixture(){const capture={chainId:'0x2105',transaction:{hash:h('a'),from:a('1'),to:a('2'),blockHash:h('b'),blockNumber:'0x64',value:'0x16345785d8a0000'},receipt:{transactionHash:h('a'),blockHash:h('b'),blockNumber:'0x64',status:'0x1'},block:{hash:h('b'),number:'0x64',transactions:[h('a')]}};return {checked_at:'2026-11-01T00:00:00Z',input:{chain:'base',txHash:h('a')},references:[{operator:'A',capture:structuredClone(capture)},{operator:'B',capture:structuredClone(capture)}],provider:{status:200,body:{provider_status:'ok',intent:'ONCHAIN_TX_LOOKUP_GENERAL',request_schema_version:4,response_format_version:4,tx_hash:h('a'),status:'confirmed',from:a('1'),to:a('2'),block_number:100,value_eth:0.1}},refusals:['unsupported_chain','malformed_hash'].map(name=>({name,status:422,body:{error:{code:'INVALID_INPUT'}}}))};}
test('reference comparison accepts exact whole ETH without depending on Provider parser',()=>{const r=assessTxPair(fixture());assert(r.pass);assert.equal(r.reference.transferred_wei,'100000000000000000');assert.equal(r.telegraph_requests,0);});
test('refreshed 1/1 captures replay alongside 4/4 and mixed versions are rejected',()=>{
  const x=fixture();
  x.provider.body.request_schema_version=1;
  assert.equal(assessTxPair(x).pass,false);
  x.provider.body.response_format_version=1;
  const report=assessTxPair(x);
  assert(report.pass);
  assert.deepEqual(report.provider_contract_versions,{request:1,response:1});
});
test('event window uses UTC opening time even after the IST date has changed',()=>{assert.equal(eventWindow('2026-11-01T00:30:00+05:30'),'pre_event');assert.equal(eventWindow('2026-11-01T05:30:00+05:30'),'event_period');assert.equal(eventWindow('2026-12-01T23:59:00Z'),'event_period');assert.equal(eventWindow('2026-12-01T23:59:01Z'),'after_event');assert.throws(()=>eventWindow('invalid'));});
test('reference conflict, wrong chain, missing receipt and false inclusion cannot become a pass',()=>{for(const mutate of [x=>x.references[1].capture.transaction.value='0x0',x=>x.references[1].capture.chainId='0x1',x=>x.references[1].capture.receipt=null,x=>x.references[1].capture.block.transactions=[],x=>x.references[1].capture.block.hash=h('c'),x=>x.references[1].operator='A']){const x=fixture();mutate(x);assert.equal(assessTxPair(x).pass,false);}});
test('wrong canonical fields and native-unit mistakes fail independently of correct scored block height',()=>{for(const mutate of [a=>a.status='confirmed_final',a=>a.tx_hash=h('c'),a=>a.from=a.to,a=>a.to=a.from,a=>a.block_number=101,a=>a.value_eth=1e17,a=>a.value_eth=0.10000000000000002,a=>a.response_format_version=5]){const x=fixture();mutate(x.provider.body);assert.equal(assessTxPair(x).pass,false);}});
test('reverted execution transfers zero despite a nonzero attempted value',()=>{const x=fixture();for(const r of x.references)r.capture.receipt.status='0x0';x.provider.body.status='reverted';x.provider.body.value_eth=0;assert(assessTxPair(x).pass);x.provider.body.value_eth=0.1;assert.equal(assessTxPair(x).pass,false);});
test('reference transaction chainId cannot contradict its RPC chain',()=>{
  const capture=fixture();
  for(const row of capture.references)row.capture.transaction.chainId='0x1';
  const report=assessTxPair(capture);
  assert.equal(report.pass,false);
  assert.match(report.failures[0],/Transaction chain differs/);
});
test('missing, duplicated or fabricated-success refusal records do not earn acceptance',()=>{for(const mutate of [x=>x.refusals.pop(),x=>x.refusals.push(x.refusals[0]),x=>x.refusals[0].status=503,x=>x.refusals[0].body.block_number=0]){const x=fixture();mutate(x);assert.equal(assessTxPair(x).pass,false);}});
