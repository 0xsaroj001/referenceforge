// Separately implemented reference arithmetic for a direct Provider check.
// This does not authenticate supplied captures or certify a node-shaped answer.
import assert from 'node:assert/strict';
import {parseUniqueJson} from '../../evaluator-v2/strict-json.mjs';
export const WALLET_INTENT='WALLET_BALANCE_CHECK_GENERAL';
export const PROVIDER_ORIGIN='https://referenceforge.0xsaroj001.workers.dev';
export const WALLET_NETWORKS=Object.freeze({
  base:{id:8453n,sources:['https://mainnet.base.org','https://base-rpc.publicnode.com']},
  'base-sepolia':{id:84532n,sources:['https://sepolia.base.org','https://base-sepolia-rpc.publicnode.com']}
});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x);
const quantity=x=>{assert(typeof x==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(x)&&x.length<=66,'MALFORMED_QUANTITY');return BigInt(x);};
const integer=x=>{assert(typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x),'MALFORMED_INTEGER');return BigInt(x);};
const time=x=>{assert(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)&&Number.isFinite(Date.parse(x)),'MALFORMED_TIME');const normalized=x.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>'.'+(fraction??'').padEnd(3,'0')+'Z');assert.equal(new Date(Date.parse(x)).toISOString(),normalized,'MALFORMED_TIME');return Date.parse(x);};
export function walletInput(chain,account){
  assert(Object.hasOwn(WALLET_NETWORKS,chain)&&address(account),'UNSUPPORTED_REQUEST');
  return {chain,address:account.toLowerCase()};
}
function tokenWei(token){
  const m=token.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);assert(m,'INVALID_BALANCE');
  const exponent=18+Number(m[3]??0)-(m[2]??'').length,digits=BigInt(m[1]+(m[2]??''));
  assert(Math.abs(exponent)<=350,'UNSUPPORTED_PRECISION');
  if(exponent>=0)return digits*10n**BigInt(exponent);
  const divisor=10n**BigInt(-exponent);assert(digits%divisor===0n,'SUB_WEI_NUMBER');return digits/divisor;
}
export function numericBalanceWei(value){
  assert(typeof value==='number'&&Number.isFinite(value)&&value>=0&&!Object.is(value,-0)&&value<=1e15,'INVALID_BALANCE');
  return tokenWei(String(value));
}
export function providerBalanceToken(raw){
  assert(typeof raw==='string'&&Buffer.byteLength(raw)<=2097152,'RAW_PROVIDER_BODY_REQUIRED');
  parseUniqueJson(raw); // Validate syntax and duplicate keys before scanning.
  let depth=0;
  for(let i=0;i<raw.length;i++){
    if(raw[i]==='"'){
      const start=i++;
      for(;i<raw.length;i++){if(raw[i]==='\\')i++;else if(raw[i]==='"')break;}
      let next=i+1;while(/\s/.test(raw[next]??'')&&next<raw.length)next++;
      if(depth===1&&raw[next]===':'&&JSON.parse(raw.slice(start,i+1))==='balance'){
        const token=raw.slice(next+1).match(/^\s*(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*(?=[,}])/);
        assert(token,'NUMERIC_BALANCE_TOKEN_REQUIRED');return token[1];
      }
    }else if(raw[i]==='{'||raw[i]==='[')depth++;else if(raw[i]==='}'||raw[i]===']')depth--;
  }
  throw Error('NUMERIC_BALANCE_TOKEN_REQUIRED');
}
export function walletReference(capture){
  const input=walletInput(capture.input.chain,capture.input.address),network=WALLET_NETWORKS[input.chain];
  const checked=time(capture.checked_at),answer=capture.provider?.body,evidence=answer?.evidence;
  assert(capture.provider?.status===200&&answer?.provider_status==='ok'&&answer.intent===WALLET_INTENT,'PROVIDER_UNAVAILABLE_OR_WRONG_INTENT');
  const balanceToken=providerBalanceToken(capture.provider.raw_body);
  assert.deepEqual(parseUniqueJson(capture.provider.raw_body),answer,'RAW_PROVIDER_BODY_MISMATCH');
  assert(tokenWei(balanceToken)===numericBalanceWei(answer.balance),'PROVIDER_NUMBER_TOKEN_PRECISION_LOSS');
  assert(same(answer.address,input.address)&&answer.chain===input.chain&&answer.token_symbol==='ETH','ANSWER_IDENTITY_OR_UNITS');
  const observed=time(answer.as_of);assert(observed<=checked+10000&&checked-observed<=60000,'STALE_OR_FUTURE_OBSERVATION');
  assert(evidence?.network===input.chain&&integer(evidence.chain_id)===network.id&&same(evidence.address,input.address)&&evidence.token===null&&evidence.token_decimals==='18'&&evidence.unit==='ETH'&&evidence.verified_answer===true,'PROVIDER_EVIDENCE_IDENTITY');
  assert(evidence.observed_at===answer.as_of,'OBSERVATION_DISAGREEMENT');
  const block=evidence.block;assert(hash(block?.hash),'MISSING_SNAPSHOT_HASH');
  const height=integer(block.number),seconds=integer(block.timestamp);
  assert(height<=1000000000000n&&seconds<=BigInt(Math.floor(Number.MAX_SAFE_INTEGER/1000)),'BLOCK_RANGE');
  assert(Number(seconds)*1000<=observed+10000&&observed-Number(seconds)*1000<=120000,'STALE_OR_FUTURE_BLOCK');
  const rows=capture.references;assert(Array.isArray(rows)&&rows.length===2,'TWO_SOURCES_REQUIRED');
  assert(new Set(rows.map(x=>x.source)).size===2&&rows.every(x=>network.sources.includes(x.source)),'REFERENCE_SOURCE_IDENTITY');
  const values=rows.map(row=>{
    assert(!row.error&&quantity(row.chain_id)===network.id,'REFERENCE_CHAIN_OR_TRANSPORT');
    const completed=time(row.completed_at);assert(completed<=checked&&checked-completed<=60000,'STALE_REFERENCE_CAPTURE');
    for(const header of [row.block,row.canonical_after]){
      assert(hash(header?.hash)&&same(header.hash,block.hash)&&quantity(header.number)===height&&quantity(header.timestamp)===seconds,'REFERENCE_BLOCK_OR_REORG');
    }
    const head=row.head;assert(hash(head?.hash)&&quantity(head.number)>=height&&quantity(head.timestamp)>=seconds,'INVALID_REFERENCE_HEAD');
    const headMs=Number(quantity(head.timestamp))*1000;
    assert(headMs<=completed+10000&&completed-headMs<=120000,'STALE_REFERENCE_HEAD');
    assert(row.query?.method==='eth_getBalance'&&same(row.query.params?.[0],input.address)&&same(row.query.params?.[1]?.blockHash,block.hash)&&row.query.params[1].requireCanonical===true&&row.query.params.length===2,'UNBOUND_REFERENCE_QUERY');
    return quantity(row.balance_wei);
  });
  assert(values[0]===values[1],'REFERENCE_BALANCE_DISAGREEMENT');
  assert(integer(evidence.value_raw)===values[0],'PROVIDER_RAW_BALANCE_MISMATCH');
  assert(numericBalanceWei(answer.balance)===values[0],'CANONICAL_BALANCE_OR_PRECISION_MISMATCH');
  return {address:input.address,chain:input.chain,block_hash:block.hash.toLowerCase(),block_number:height.toString(),balance_wei:values[0].toString(),balance:answer.balance,token_symbol:'ETH',as_of:answer.as_of,six_decimal_exact:values[0]%1000000000000n===0n};
}
export function assessWalletProof(capture){
  const report={checked_at:capture.checked_at,intent:WALLET_INTENT,pass:false,failures:[],checks:[],
    evidence_kind:capture.synthetic?'synthetic_demonstration':'direct_provider_and_rpc_capture',
    node_shaping_verified:false,platform_admission_verified:false,cryptographic_state_proof:false,
    source_operator_independence_verified:false,independent_human_review:false,telegraph_requests:0,payments:0};
  try{
    const contract=capture.contract;assert(contract?.status===200&&contract.body?.intent_id===WALLET_INTENT&&contract.body.class==='deterministic','CONTRACT_DRIFT');
    assert.deepEqual(contract.body.request.params.map(x=>[x.name,x.type,!!x.required]),[['address','string',true],['chain','string',true],['token','string',false]],'CONTRACT_REQUEST_DRIFT');
    const fields=contract.body.response.fields;assert.deepEqual(fields.map(x=>[x.name,x.type]),[['address','string'],['chain','string'],['balance','number'],['token_symbol','string'],['as_of','string']],'CONTRACT_FIELDS_DRIFT');
    const balance=fields.find(x=>x.name==='balance');assert(balance.unit==='whole token units'&&balance.decimals===6&&balance.scored===true&&JSON.stringify(balance.range)==='[0,1000000000000000]','CONTRACT_BALANCE_DRIFT');
    report.reference=walletReference(capture);
    report.raw_metadata_versions={request:capture.provider.body.request_schema_version,response:capture.provider.body.response_format_version};
    report.live_contract_versions={request:contract.body.request.schema_version,response:contract.body.response.format_version};
    report.raw_metadata_versions_match_live_contract=report.raw_metadata_versions.request===report.live_contract_versions.request&&report.raw_metadata_versions.response===report.live_contract_versions.response;
    report.checks.push('five canonical field values and snapshot match two fixed RPC reads','exact integer wei/ETH equality; no rounding','hash-pinned state with canonical header recheck');
  }catch(error){report.failures.push(error.message.split('\n')[0]);}
  for(const name of ['unsupported_chain','malformed_address','unsupported_token']){
    const rows=capture.refusals?.filter(x=>x.name===name)??[],row=rows[0];
    if(rows.length!==1||row.status!==422||typeof row.body?.error?.code!=='string'||Object.hasOwn(row.body,'balance')||row.body?.provider_status==='ok')report.failures.push('REFUSAL_FAILED:'+name);
    else report.checks.push('refusal:'+name);
  }
  report.pass=report.failures.length===0;
  report.scope='Direct Provider source-consistency check, not a Telegraph Engine request, node-shaped output, independent use, finality proof or unseen-quality benchmark. Six-decimal score encoding and raw metadata version drift are reported separately.';
  return report;
}
