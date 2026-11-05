// Separate reference transformation for a Provider integration test, not an external judge.
import assert from 'node:assert/strict';
export const TX_INTENT='ONCHAIN_TX_LOOKUP_GENERAL';
export const EVENT_START=Date.parse('2026-11-01T00:00:00Z');
export const EVENT_END=Date.parse('2026-12-01T23:59:00Z');
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x);
const hex=x=>{assert(typeof x==='string'&&/^0x[0-9a-f]+$/i.test(x),'Invalid RPC quantity');return BigInt(x);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function eventWindow(checkedAt){
  const time=Date.parse(checkedAt);assert(Number.isFinite(time),'Invalid capture timestamp');
  return time<EVENT_START?'pre_event':time>EVENT_END?'after_event':'event_period';
}
export function referenceOutcome(capture,{chain,txHash}){
  assert(['base','base-sepolia'].includes(chain)&&hash(txHash),'Unsupported reference input');
  const {chainId,transaction:tx,receipt,block}=capture;
  assert.equal(hex(chainId),chain==='base'?8453n:84532n,'Reference chain differs');
  assert(tx&&receipt&&block,'Missing reference evidence; no invented pending/not-found answer');
  if(tx.chainId!==undefined)assert.equal(hex(tx.chainId),hex(chainId),'Transaction chain differs');
  assert(hash(tx.hash)&&same(tx.hash,txHash)&&same(receipt.transactionHash,txHash),'Reference transaction identity differs');
  assert(address(tx.from)&&address(tx.to),'Contract creation or malformed address is outside this test');
  assert(hash(tx.blockHash)&&same(tx.blockHash,receipt.blockHash)&&same(tx.blockHash,block.hash),'Reference block identity differs');
  const height=hex(tx.blockNumber);
  assert.equal(height,hex(receipt.blockNumber),'Receipt height differs');assert.equal(height,hex(block.number),'Block height differs');
  assert(height<=1000000000000n,'Block outside canonical field range');
  assert(Array.isArray(block.transactions)&&block.transactions.some(x=>same(x,txHash)),'Transaction absent from supplied block');
  if(receipt.from!==undefined)assert(same(receipt.from,tx.from),'Receipt sender differs');
  if(receipt.to!==undefined)assert(same(receipt.to,tx.to),'Receipt recipient differs');
  const status=hex(receipt.status);assert(status===0n||status===1n,'Invalid receipt execution status');
  const attemptedWei=hex(tx.value),transferredWei=status===1n?attemptedWei:0n;
  return {tx_hash:txHash.toLowerCase(),status:status===1n?'confirmed':'reverted',from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),block_number:height.toString(),transferred_wei:transferredWei.toString(),attempted_wei:attemptedWei.toString(),block_hash:tx.blockHash.toLowerCase()};
}
function decimalRatio(value){
  assert(typeof value==='number'&&Number.isFinite(value)&&value>=0,'Invalid native value');
  const match=String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);assert(match,'Invalid numeric decimal');
  const fraction=match[2]??'',exponent=Number(match[3]??0)-fraction.length;
  assert(Math.abs(exponent)<=350,'Numeric exponent outside test bounds');
  const digits=BigInt(match[1]+fraction);
  return exponent>=0?[digits*10n**BigInt(exponent),1n]:[digits,10n**BigInt(-exponent)];
}
export function assessTxAnswer({checked_at,input,references,provider}){
  const report={checked_at,event_window:eventWindow(checked_at),intent:TX_INTENT,pass:false,failures:[],checks:[],scope:'Author-run direct HTTP integration test with separately implemented arithmetic over two public RPC captures; not an independent reviewer, model comparison, Telegraph route, app adoption or finality proof.',telegraph_requests:0,payments:0};
  try{
    assert(references?.length===2&&new Set(references.map(x=>x.operator)).size===2,'Two distinct reference operators required');
    const outcomes=references.map(row=>referenceOutcome(row.capture,input));
    assert.deepEqual(outcomes[0],outcomes[1],'Reference operators disagree');report.reference=outcomes[0];
    assert.equal(provider.status,200,'Provider did not fulfill the request');const answer=provider.body,expected=outcomes[0];
    assert(answer?.provider_status==='ok'&&answer.intent===TX_INTENT,'Wrong Provider identity/status');
    const requestVersion=answer.request_schema_version,responseVersion=answer.response_format_version;
    report.provider_contract_versions={request:requestVersion,response:responseVersion};
    assert(requestVersion===responseVersion&&(requestVersion===1||requestVersion===4),'Unsupported transaction contract version pair');
    for(const key of ['tx_hash','from','to'])assert(same(answer[key],expected[key]),'Wrong '+key);
    assert.equal(answer.status,expected.status,'Wrong execution status');
    assert(Number.isSafeInteger(answer.block_number)&&BigInt(answer.block_number)===BigInt(expected.block_number),'Wrong block number');
    assert(answer.value_eth<=1e12,'Native value outside canonical range');
    const [numerator,denominator]=decimalRatio(answer.value_eth);
    assert.equal(numerator*10n**18n,BigInt(expected.transferred_wei)*denominator,'Wrong native value or units');
    report.checks.push('six canonical fields match the separately decoded reference','two reference operators agree on block and transaction');
  }catch(error){report.failures.push(error.message);}
  report.pass=report.failures.length===0;return report;
}
export function assessTxPair(capture){
  const report=assessTxAnswer(capture),refusals=capture.refusals??[];
  const expectedRefusals=['unsupported_chain','malformed_hash'];
  for(const name of expectedRefusals){
    const matches=refusals.filter(x=>x.name===name),row=matches[0];
    if(matches.length!==1||row.status!==422||typeof row.body?.error?.code!=='string'||row.body?.provider_status==='ok'||row.body?.block_number!==undefined||row.body?.value_eth!==undefined)report.failures.push('Required refusal failed: '+name);
    else report.checks.push('refusal: '+name);
  }
  report.pass=report.failures.length===0;return report;
}
