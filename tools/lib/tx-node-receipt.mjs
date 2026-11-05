import assert from 'node:assert/strict';
import {parseUniqueJson} from '../../evaluator-v2/strict-json.mjs';
import {decimal} from '../../src/decimal.mjs';
import {assessTxAnswer,TX_INTENT} from './provider-tx-acceptance.mjs';

const owner='0xfec66e0f5c64296ff190edced88c781eeedfd9d3';
const fields=['tx_hash','status','from','to','block_number','value_eth'];

// Check exact numeric tokens before JSON.parse can silently round them.
export function parseTxCapture(raw){
  assert(typeof raw==='string'&&Buffer.byteLength(raw)<=2097152,'BOUNDED_JSON_REQUIRED');
  let value;
  try { value=parseUniqueJson(raw); }
  catch(error) { assert.fail(error.code==='DUPLICATE_JSON_KEY'?'DUPLICATE_JSON_KEY':'INVALID_JSON'); }
  for(const [token] of raw.matchAll(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g)){
    if(token.startsWith('"'))continue;
    const exact=decimal(token),parsed=decimal(String(Number(token)));
    assert(exact.n*parsed.d===parsed.n*exact.d,'JSON_NUMBER_PRECISION_LOSS');
  }
  return value;
}

export function assessTxNodeReceipt(rawReceipt,sourceCapture){
  const report={
    pass:false,failures:[],field_checks:[],scope:'Supplied transaction receipt and source-capture consistency',
    node_origin_authenticated:false,execution_correlation_verified:false,
    signal_payload_binding_verified:false,score_encoding_verified:false,mission_verified:false
  };
  try{
    const receipt=parseTxCapture(rawReceipt),binding=sourceCapture.binding;
    assert(binding?.registration&&binding.discovery&&binding.contract,'PUBLIC_BINDING_REQUIRED');
    const {registration,discovery,contract}=binding;
    assert.equal(registration.registration_id,4889,'WRONG_REGISTRATION');
    assert.equal(registration.slug,'referenceforge-numeric','REGISTRATION_SLUG');
    assert.equal(registration.activation_status,'active','REGISTRATION_INACTIVE');
    assert.equal(registration.miner_address?.toLowerCase(),owner,'REGISTRATION_OWNER');
    assert.equal(discovery.slug,registration.slug,'DISCOVERY_SLUG');
    assert.equal(discovery.activation_status,'active','DISCOVERY_INACTIVE');
    assert.equal(discovery.wallet_address?.toLowerCase(),owner,'DISCOVERY_OWNER');
    assert(/^\d+$/.test(String(discovery.id)),'DISCOVERY_ID');
    assert.equal(String(receipt.miner_id),String(discovery.id),'WRONG_ENGINE_MINER');
    assert.equal(receipt.intent,TX_INTENT,'WRONG_INTENT');
    assert.equal(receipt.endpoint,'/v2/tx','WRONG_ENDPOINT');
    assert.equal(contract.intent_id,TX_INTENT,'CONTRACT_INTENT');
    assert.equal(contract.request.schema_version,1,'UNSUPPORTED_REQUEST_CONTRACT');
    assert.equal(contract.response.format_version,1,'UNSUPPORTED_RESPONSE_CONTRACT');
    assert.deepEqual(contract.response.fields.map(f=>f.name),fields,'CONTRACT_FIELDS');
    assert.equal(receipt.input_schema_version,contract.request.schema_version,'INPUT_VERSION');
    assert.equal(receipt.format_version,contract.response.format_version,'FORMAT_VERSION');
    assert.equal(receipt.result_shape,'intent','RAW_FALLBACK');
    assert(!receipt.shape_error,'SHAPE_ERROR');
    assert.deepEqual(Object.keys(receipt.input??{}).sort(),['chain','tx_hash'],'INPUT_FIELDS');
    assert.equal(receipt.input.chain,sourceCapture.input.chain,'INPUT_CHAIN');
    assert.equal(receipt.input.tx_hash?.toLowerCase(),sourceCapture.input.txHash?.toLowerCase(),'INPUT_HASH');
    const source=assessTxAnswer(sourceCapture);
    assert(source.pass,'SOURCE_CAPTURE_FAILED');
    report.reference=source.reference;
    report.provider_contract_versions=source.provider_contract_versions;
    assert.deepEqual(Object.keys(receipt.result??{}),fields,'RESULT_FIELDS_OR_ORDER');
    assert.deepEqual(Object.keys(receipt.field_status??{}).sort(),[...fields].sort(),'STATUS_FIELDS');
    for(const name of fields){
      const status=receipt.field_status[name];
      const matches=receipt.result[name]===sourceCapture.provider.body[name];
      report.field_checks.push({field:name,status,matches_provider:matches});
      if(status!=='ok')report.failures.push('FIELD_NOT_OK:'+name);
      if(!matches)report.failures.push('VALUE_MISMATCH:'+name);
    }
    assert(/^0x[0-9a-f]{64}$/i.test(receipt.signal_hash??''),'SIGNAL_HASH_REQUIRED');
    report.engine_miner_id=String(discovery.id);
    report.registration_id=registration.registration_id;
    report.signal_hash=receipt.signal_hash;
    const requestId=sourceCapture.provider.request_id;
    report.provider_request_id=typeof requestId==='string'&&/^[0-9a-f-]{36}$/.test(requestId)?requestId:null;
    report.pass=report.failures.length===0;
  }catch(error){report.failures.push(error.message.split('\n')[0]);}
  return report;
}
