import { ServiceError } from '../errors.mjs';
import { NETWORKS, parseTransfer, parseMetric, parseWallet, fail } from './input.mjs';
import { createRpcSession, digest } from './rpc.mjs';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function invalid() { fail('INVALID_RPC_DATA', 'RPC data was malformed or internally inconsistent; no verified answer', 503); }
export function quantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || value.length > 66) invalid();
  return BigInt(value);
}
const q = value => quantity(value).toString();
const hex = value => '0x' + BigInt(value).toString(16);
function data(value, bytes) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value) || bytes !== undefined && value.length !== 2+bytes*2) invalid();
  return value.toLowerCase();
}
const nullableAddress = value => value === null ? null : data(value, 20);
function same(a,b,code='RPC_DISAGREEMENT') {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(code, 'The independent sources disagree on the requested chain, block or value. No majority or cached substitute.', 503);
  return a;
}
function header(raw) {
  if (!raw) fail('BLOCK_UNAVAILABLE', 'Requested block is unavailable from at least one source', 503);
  return { number:q(raw.number), hash:data(raw.hash,32), timestamp:q(raw.timestamp), parent_hash:data(raw.parentHash,32), base_fee_per_gas:raw.baseFeePerGas===undefined?null:q(raw.baseFeePerGas) };
}
function validHead(raw, now) {
  const h=header(raw), age=BigInt(Math.floor(now()/1000))-BigInt(h.timestamp);
  if(age < -10n || age > 120n) fail('STALE_RPC_HEAD','An RPC head is in the future or more than 120 seconds old',503);
  return h;
}
function transaction(raw, expectedHash, chainId) {
  if(raw===null)return null;
  if(!raw || typeof raw!=='object')invalid();
  const x={hash:data(raw.hash,32),from:data(raw.from,20),to:nullableAddress(raw.to),value_wei:q(raw.value),nonce:q(raw.nonce),gas_limit:q(raw.gas),input:data(raw.input),type:q(raw.type??'0x0'),block_hash:raw.blockHash===null?null:data(raw.blockHash,32),block_number:raw.blockNumber===null?null:q(raw.blockNumber),transaction_index:raw.transactionIndex===null?null:q(raw.transactionIndex)};
  if(x.hash!==expectedHash || raw.chainId!==undefined && quantity(raw.chainId)!==chainId || (x.block_hash===null)!==(x.block_number===null) || (x.block_hash===null)!==(x.transaction_index===null))invalid();
  if(!['0','1','2','3','4'].includes(x.type))fail('UNSUPPORTED_TRANSACTION_TYPE','System/deposit and unknown transaction types are outside the supported fee and transfer scope');
  return x;
}
function logEntry(raw, receipt) {
  if(!raw || raw.removed!==false || !Array.isArray(raw.topics) || raw.topics.length>4)invalid();
  const x={address:data(raw.address,20),topics:raw.topics.map(x=>data(x,32)),data:data(raw.data),log_index:q(raw.logIndex)};
  if(data(raw.blockHash,32)!==receipt.block_hash || q(raw.blockNumber)!==receipt.block_number || data(raw.transactionHash,32)!==receipt.tx_hash || q(raw.transactionIndex)!==receipt.transaction_index)invalid();
  return x;
}
function receipt(raw, tx) {
  if(raw===null)return null;
  if(!tx || !raw || !Array.isArray(raw.logs) || raw.logs.length>2048)invalid();
  const x={tx_hash:data(raw.transactionHash,32),from:data(raw.from,20),to:nullableAddress(raw.to),block_hash:data(raw.blockHash,32),block_number:q(raw.blockNumber),transaction_index:q(raw.transactionIndex),status:q(raw.status),gas_used:q(raw.gasUsed),effective_gas_price:q(raw.effectiveGasPrice),l1_fee_wei:raw.l1Fee===undefined?null:q(raw.l1Fee),operator_fee_scalar:raw.operatorFeeScalar===undefined?null:q(raw.operatorFeeScalar),operator_fee_constant:raw.operatorFeeConstant===undefined?null:q(raw.operatorFeeConstant)};
  if(!['0','1'].includes(x.status)||x.tx_hash!==tx.hash||x.from!==tx.from||x.to!==tx.to||x.block_hash!==tx.block_hash||x.block_number!==tx.block_number||x.transaction_index!==tx.transaction_index||BigInt(x.gas_used)>BigInt(tx.gas_limit))invalid();
  let previous=-1n;
  x.logs=raw.logs.map(rawLog=>{const l=logEntry(rawLog,x);if(BigInt(l.log_index)<=previous)invalid();previous=BigInt(l.log_index);return l;});
  if(x.status==='0'&&x.logs.length)invalid();
  return x;
}
function fees(r,h) {
  if(!r)return null;
  const used=BigInt(r.gas_used),price=BigInt(r.effective_gas_price),base=h.base_fee_per_gas===null?null:BigInt(h.base_fee_per_gas);
  if(base!==null&&price<base)invalid();
  return {gas_used:r.gas_used,effective_gas_price_wei:r.effective_gas_price,execution_fee_wei:(used*price).toString(),base_fee_component_wei:base===null?null:(used*base).toString(),priority_fee_component_wei:base===null?null:(used*(price-base)).toString(),l1_data_fee_wei:r.l1_fee_wei,known_fee_subtotal_wei:r.l1_fee_wei===null?null:(used*price+BigInt(r.l1_fee_wei)).toString(),operator_fee_scalar:r.operator_fee_scalar,operator_fee_constant_wei:r.operator_fee_constant,total_fee_wei:null,l2_base_fee_disposition:'fee_vault_not_burned',scope:'Execution fee and provider-reported L1/operator parameters. Complete total and Ethereum L1 burn allocation are not asserted on Base.'};
}
function common(intent,input,network,rpc,observedAt) {
  return { status:'ok',intent,network:input.chain,chain_id:network.chainId.toString(),observed_at:observedAt,verification:{method:'two_operator_exact_agreement',sources:rpc.evidence,rpc_cost:rpc.stats(),cryptographic_state_proof:false},limitations:['Two RPC operators can still share an upstream or common fault; agreement is not a Merkle inclusion proof.','Only Base/Base Sepolia EVM scope is implemented.'] };
}
export function createOnchainMiner({ networks=NETWORKS, fetchImpl=fetch, now=Date.now, rpcTimeoutMs=2600, requestTimeoutMs=8000,onRpcError }={}) {
  function session(input,externalSignal) {
    const network=networks[input.chain];
    if(!network)fail('UNSUPPORTED_CHAIN','Network is not configured');
    const deadline=AbortSignal.timeout(requestTimeoutMs),signal=externalSignal?AbortSignal.any([externalSignal,deadline]):deadline;
    const rpc=createRpcSession(network,{fetchImpl,signal,rpcTimeoutMs,onRpcError});
    return {network,rpc};
  }
  async function txEvidence(input,intent,externalSignal) {
    const {network,rpc}=session(input,externalSignal);
    const first=await rpc.both([{method:'eth_chainId'},{method:'eth_getBlockByNumber',params:['latest',false]},{method:'eth_getTransactionByHash',params:[input.tx_hash]},{method:'eth_getTransactionReceipt',params:[input.tx_hash]}]);
    const views=first.map(([chain,head,tx,r])=>{if(quantity(chain)!==network.chainId)fail('WRONG_RPC_CHAIN','An RPC returned a different chain ID',503);const t=transaction(tx,input.tx_hash,network.chainId);return {head:validHead(head,now),tx:t,receipt:receipt(r,t)};});
    const tx=same(views[0].tx,views[1].tx),r=same(views[0].receipt,views[1].receipt);
    const headHeight=views.reduce((n,x)=>BigInt(x.head.number)<n?BigInt(x.head.number):n,BigInt(views[0].head.number));
    if(views.some(x=>BigInt(x.head.number)-headHeight>4n))fail('RPC_HEAD_DIVERGENCE','RPC heads differ by more than four blocks',503);
    if(!tx || tx.block_hash===null) {
      if(r)invalid();
      return {result:{...common(intent,input,network,rpc,new Date(now()).toISOString()),tx_hash:input.tx_hash,state:tx?'pending':'unknown',verified_answer:false,fulfillment:'inconclusive',claim_verified:false,score_value:null,transaction:tx,receipt:null,confirmations_l2:'0',summary:tx?'Transaction is pending; no mined transfer can be verified.':'Both sources currently return no transaction; this does not prove nonexistence.'},rpc};
    }
    if(!r)fail('INCOMPLETE_RECEIPT','Mined transaction lacks a receipt; no verified answer',503);
    if(BigInt(r.block_number)>headHeight)fail('RPC_HEAD_BEHIND_RECEIPT','A source head precedes the receipt block',503);
    const [[a,headA],[b,headB]]=await rpc.both([{method:'eth_getBlockByNumber',params:[hex(r.block_number),false]},{method:'eth_getBlockByNumber',params:[hex(headHeight),false]}]);
    const block=same(header(a),header(b),'REORG_OR_BLOCK_DISAGREEMENT');
    const agreedHead=same(header(headA),header(headB),'RPC_HEAD_DISAGREEMENT');
    if(agreedHead.number!==headHeight.toString()||BigInt(agreedHead.timestamp)<BigInt(block.timestamp))invalid();
    if(block.hash!==r.block_hash||block.number!==r.block_number)fail('REORG_DETECTED','Receipt is not in the sources\' agreed canonical block',503);
    const confirmations=(headHeight-BigInt(r.block_number)+1n).toString();
    return {result:{...common(intent,input,network,rpc,new Date(now()).toISOString()),tx_hash:input.tx_hash,state:r.status==='1'?'mined_success':'reverted',verified_answer:true,fulfillment:'answered',transaction:tx,receipt:r,block,confirmations_l2:confirmations,confirmation_scope:'L2 block inclusion only; not Ethereum L1 finality or bridge settlement',fees:fees(r,block),evidence_url:network.explorer+'/tx/'+input.tx_hash},rpc};
  }
  async function transfer(params,{signal}={}) {
    const input=parseTransfer(params),{result}=await txEvidence(input,'CRYPTO_TRANSFER_VERIFY',signal);
    const output={...result,asset:input.asset,token:input.token??null,expectation:input,transfers:[],claim_verified:false,score_value:result.verified_answer?'0':null};
    if(!result.verified_answer)return output;
    if(result.state==='reverted')return {...output,summary:'Transaction reverted; the proposed transfer is not verified.'};
    if(input.asset==='native') {
      if(result.transaction.to && BigInt(result.transaction.value_wei)>0n)output.transfers=[{from:result.transaction.from,to:result.transaction.to,amount_raw:result.transaction.value_wei,unit:'wei',evidence:'top_level_transaction_value'}];
      output.limitations=[...output.limitations,'Native verification covers top-level value only, not internal calls, recipient retention or bridge settlement.'];
    } else {
      output.transfers=result.receipt.logs.filter(l=>l.address===input.token&&l.topics[0]===TRANSFER_TOPIC).map(l=>{
        if(l.topics.length!==3||l.data.length!==66||!/^0x0{24}[0-9a-f]{40}$/.test(l.topics[1])||!/^0x0{24}[0-9a-f]{40}$/.test(l.topics[2]))invalid();
        return {from:'0x'+l.topics[1].slice(-40),to:'0x'+l.topics[2].slice(-40),amount_raw:BigInt(l.data).toString(),unit:'token_base_units',log_index:l.log_index,evidence:'erc20_transfer_event'};
      });
      output.limitations=[...output.limitations,'ERC-20 verification attests receipt events from the requested contract, not token legitimacy, balance deltas, NFT transfers or economic finality.'];
    }
    const match=output.transfers.some(t=>(input.expected_from===undefined||t.from===input.expected_from)&&(input.expected_to===undefined||t.to===input.expected_to)&&(input.expected_amount===undefined||t.amount_raw===input.expected_amount));
    const enough=BigInt(result.confirmations_l2)>=BigInt(input.min_confirmations);
    return {...output,verified_answer:enough,claim_verified:match&&enough,score_value:enough?(match?'1':'0'):null,fulfillment:enough?'answered':'inconclusive',summary:!enough?'Mined transfer has not reached the requested number of L2 confirmations.':match?'Requested transfer is supported by two RPC sources at the same canonical inclusion block.':'Mined transaction does not contain a single transfer matching all supplied expectations.'};
  }
  async function metric(params,{signal}={}) {
    const input=parseMetric(params);
    if(['transaction','gas','logs'].includes(input.metric)) {
      const {result}=await txEvidence(input,'ONCHAIN_METRIC_VERIFY',signal);
      const score=result.verified_answer?(input.metric==='gas'?result.receipt.gas_used:input.metric==='logs'?String(result.receipt.logs.length):result.state==='mined_success'?'1':'0'):null;
      return {...result,metric:input.metric,score_value:score,value:input.metric==='gas'?result.fees:input.metric==='logs'?result.receipt?.logs??null:result.transaction,unit:input.metric==='gas'?'gas':input.metric==='logs'?'receipt_logs':'execution_status',summary:result.summary??'Transaction metric is cross-checked at its canonical inclusion block.'};
    }
    return balanceEvidence(input, signal);
  }
  async function balanceEvidence(input, signal, wallet = false) {
    const {network,rpc}=session(input,signal);
    const dynamic = ['safe','finalized','current'].includes(input.block);
    const first=await rpc.both(input.block==='current'?[{method:'eth_chainId'},{method:'eth_getBlockByNumber',params:['latest',false]}]:[{method:'eth_chainId'},{method:'eth_getBlockByNumber',params:[input.block,false]},{method:'eth_getBlockByNumber',params:['latest',false]}]);
    const views=first.map(([chain,raw,head])=>{if(quantity(chain)!==network.chainId)fail('WRONG_RPC_CHAIN','RPC chain ID mismatch',503);const view={block:header(raw),head:validHead(input.block==='current'?raw:head,now)};if(BigInt(view.block.number)>BigInt(view.head.number)||BigInt(view.block.timestamp)>BigInt(view.head.timestamp))invalid();return view;});
    let height=BigInt(views[0].block.number)<BigInt(views[1].block.number)?BigInt(views[0].block.number):BigInt(views[1].block.number);
    let blocks=views.map(x=>x.block);
    if(input.block === 'current') {
      if(views.some(x=>BigInt(x.block.number)-height>4n))fail('RPC_HEAD_DIVERGENCE','Current balance source heads differ by more than four blocks',503);
      // Aggregating RPC services can route consecutive requests to backends with
      // slightly different tips. Keep a disclosed two-block buffer, then still
      // require both canonical headers, exact hash-pinned state and post-read checks.
      height=height>=2n?height-2n:0n;
    }
    if(blocks.some(x=>BigInt(x.number)!==height)) {
      if(!dynamic)fail('RPC_DISAGREEMENT','Explicit block number returned inconsistent heights',503);
      blocks=(await rpc.both([{method:'eth_getBlockByNumber',params:[hex(height),false]}])).map(x=>header(x[0]));
    }
    const block=same(blocks[0],blocks[1],'REORG_OR_BLOCK_DISAGREEMENT');
    if(!dynamic&&height!==quantity(input.block)||views.some(x=>BigInt(x.head.number)<height))invalid();
    if(input.block === 'current') {
      const age=BigInt(Math.floor(now()/1000))-BigInt(block.timestamp);
      if(age < -10n || age > 120n)fail('STALE_RPC_HEAD','Current balance block is not fresh enough',503);
    }
    if(views.some(x=>BigInt(x.head.timestamp)<BigInt(block.timestamp)))invalid();
    const reference={blockHash:block.hash,requireCanonical:true};
    const calls=input.metric==='native_balance'?[{method:'eth_getBalance',params:[input.address,reference]}]:[{method:'eth_getCode',params:[input.token,reference]},{method:'eth_call',params:[{to:input.token,data:'0x70a08231'+input.address.slice(2).padStart(64,'0'),gas:'0x186a0'},reference]}];
    if(wallet && input.metric==='erc20_balance')calls.push({method:'eth_call',params:[{to:input.token,data:'0x313ce567',gas:'0x186a0'},reference]});
    const values=await rpc.both(calls);
    if(input.metric==='erc20_balance')same(data(values[0][0]),data(values[1][0]));
    const balances=values.map(v=>{if(input.metric==='native_balance')return q(v[0]);if(data(v[0])==='0x')fail('NOT_A_CONTRACT','Requested token address has no contract code at the selected block');const word=data(v[1],32);return BigInt(word).toString();});
    const value=same(balances[0],balances[1]);
    let tokenDecimals;
    if(wallet) {
      tokenDecimals = input.metric==='native_balance' ? 18n : BigInt(same(data(values[0][2],32),data(values[1][2],32)));
      if(tokenDecimals>255n)fail('INVALID_TOKEN_DECIMALS','Token decimals is not a uint8; no display balance can be verified',503);
    }
    // Recheck canonical block after the state reads, in addition to EIP-1898.
    const check=(await rpc.both([{method:'eth_getBlockByNumber',params:[hex(height),false]}])).map(x=>header(x[0]));
    check.forEach(h=>same(h,block,'REORG_DETECTED'));
    const reportedHeights=views.map(x=>x.block.number),difference=BigInt(reportedHeights[0])>BigInt(reportedHeights[1])?BigInt(reportedHeights[0])-BigInt(reportedHeights[1]):BigInt(reportedHeights[1])-BigInt(reportedHeights[0]);
    const result={...common('ONCHAIN_METRIC_VERIFY',input,network,rpc,new Date(now()).toISOString()),metric:input.metric,requested_block:input.block,tag_resolution:dynamic?{policy:input.block==='current'?'fresh_common_head_minus_two_then_both_canonical_hash_checks':'lower_reported_height_then_both_canonical_hash_checks',reported_heights:reportedHeights,height_difference:difference.toString(),...(input.block==='current'?{confirmation_buffer_blocks:'2'}:{}),block_age_seconds:(BigInt(Math.floor(now()/1000))-BigInt(block.timestamp)).toString()}:null,block,address:input.address,token:input.token??null,value_raw:value,score_value:value,unit:input.metric==='native_balance'?'wei':'token_base_units',verified_answer:true,fulfillment:'answered',summary:'Exact balance agreed by two RPC operators, pinned to a canonical block hash using EIP-1898; no conversion through floating point.',limitations:['Agreement is not a cryptographic state proof; token contract semantics are not audited.','Dynamic tag results use the lower jointly attested height; current wallet observations also subtract two blocks. Inspect age and lag for application freshness.','Historical blocks require both providers to support archive reads; unsupported history returns unavailable.'],...(wallet?{token_decimals:tokenDecimals.toString()}: {})};
    result.evidence_sha256=await digest(JSON.stringify({chain:result.chain_id,block,metric:input.metric,address:input.address,token:input.token??null,value}));
    return result;
  }
  async function wallet(params,{signal}={}) {
    const input=parseWallet(params), result=await balanceEvidence(input, signal, true), scale=Number(result.token_decimals);
    const padded=result.value_raw.padStart(scale+1,'0'), integer=scale===0?padded:padded.slice(0,-scale), fractional=scale===0?'':padded.slice(-scale).replace(/0+$/,'');
    const amount=integer+(fractional?'.'+fractional:'');
    const out={...result,intent:'WALLET_BALANCE_CHECK',balance:amount,score_value:amount,unit:input.metric==='native_balance'?'ETH':'token_units',summary:`Address ${result.address} holds ${amount} ${input.metric==='native_balance'?'ETH':'token units of '+input.token} at jointly verified current block ${result.block.number}.`,limitations:[...result.limitations,'Base/Base Sepolia addresses only; no ENS, other chains, portfolio valuation or token legitimacy assertion. ERC-20 decimals is checked at the same canonical block.']};
    out.evidence_sha256=await digest(JSON.stringify({chain:out.chain_id,block:out.block,address:out.address,token:out.token,raw:out.value_raw,decimals:out.token_decimals,balance:amount}));
    return out;
  }
  async function lookup(params,{signal}={}) {
    if(!params||Object.keys(params).some(k=>!['chain','tx_hash','field'].includes(k)))fail('UNSUPPORTED_PARAMETER','Supply chain, tx_hash and an optional lookup field');
    const label=typeof params.field==='string'?params.field.trim().replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().replace(/[ -]+/g,'_'):params.field??'status';
    const field=({execution_status:'status',transaction_status:'status',sender:'from',recipient:'to',native_value_wei:'value_wei',confirmations:'confirmations_l2',gas_price_wei:'effective_gas_price_wei',logs_count:'log_count'})[label]??label;
    const units={status:'execution_status',gas_used:'gas',value_wei:'wei',from:'address',to:'address',block_number:'block_number',nonce:'nonce',confirmations_l2:'L2_blocks',log_count:'logs',effective_gas_price_wei:'wei_per_gas',execution_fee_wei:'wei',l1_data_fee_wei:'wei'};
    if(!Object.hasOwn(units,field))fail('UNSUPPORTED_FIELD','Choose an explicit execution status, address, block, nonce, confirmations_l2, log_count or gas/fee field with documented units; ambiguous value, price and total-fee fields are refused');
    const result=await metric({chain:params.chain,tx_hash:params.tx_hash,metric:'transaction'},{signal});
    const selected=!result.verified_answer?null:field==='status'?result.receipt.status:field==='gas_used'?result.receipt.gas_used:field==='confirmations_l2'?result.confirmations_l2:field==='log_count'?String(result.receipt.logs.length):['effective_gas_price_wei','execution_fee_wei','l1_data_fee_wei'].includes(field)?result.fees[field]:result.transaction[field];
    const available=selected!==null&&selected!==undefined;
    return {...result,intent:'ONCHAIN_TX_LOOKUP',field,score_value:available?selected:null,verified_answer:result.verified_answer&&available,fulfillment:available?'answered':'inconclusive',unit:units[field],summary:!result.verified_answer?result.summary:available?`Transaction ${result.tx_hash} is ${result.state}; ${field} = ${selected} ${units[field]}. Gas used: ${result.receipt.gas_used}. L2 confirmations: ${result.confirmations_l2}.`:'The selected transaction field is unavailable; no substituted value or fabricated complete fee is returned.'};
  }
  return {transfer,metric,wallet,lookup};
}
