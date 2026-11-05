// Local receipt consistency only: supplied JSON is not authenticated node evidence.
import assert from 'node:assert/strict';
import {parseUniqueJson} from '../../evaluator-v2/strict-json.mjs';
import {assessWalletProof,WALLET_INTENT} from './wallet-proof.mjs';
import {decimal} from '../../src/decimal.mjs';
export function assessWalletNodeReceipt(rawReceipt,sourceCapture){
  const report={pass:false,failures:[],scope:'Supplied receipt shape and source-capture consistency only',node_origin_authenticated:false,platform_admission_verified:false,score_encoding_verified:false};
  try{
    assert(typeof rawReceipt==='string'&&Buffer.byteLength(rawReceipt)<=2097152,'BOUNDED_RAW_RECEIPT_REQUIRED');
    const receipt=parseUniqueJson(rawReceipt),proof=assessWalletProof(sourceCapture);
    for(const [token] of rawReceipt.matchAll(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g)){
      if(token.startsWith('"'))continue;
      const exact=decimal(token),parsed=decimal(String(Number(token)));
      assert(exact.n*parsed.d===parsed.n*exact.d,'RECEIPT_NUMBER_PRECISION_LOSS');
    }
    assert(proof.pass,'SOURCE_CAPTURE_FAILED');
    assert.equal(String(receipt.miner_id),'4889','WRONG_MINER');
    assert.equal(receipt.intent,WALLET_INTENT,'WRONG_INTENT');
    assert.equal(receipt.result_shape,'intent','RAW_FALLBACK');assert(!receipt.shape_error,'SHAPE_ERROR');
    assert.equal(receipt.endpoint,'/v2/wallet','WRONG_ENDPOINT');
    assert.equal(receipt.format_version,sourceCapture.contract.body.response.format_version,'FORMAT_VERSION');
    assert.equal(receipt.input_schema_version,sourceCapture.contract.body.request.schema_version,'INPUT_VERSION');
    assert.equal(receipt.input?.address?.toLowerCase(),sourceCapture.input.address.toLowerCase(),'INPUT_ADDRESS');
    assert.equal(receipt.input?.chain,sourceCapture.input.chain,'INPUT_CHAIN');
    assert(Object.keys(receipt.input).every(k=>['address','chain','token'].includes(k))&&(!receipt.input.token),'INPUT_TOKEN_OR_EXTRA');
    const names=sourceCapture.contract.body.response.fields.map(x=>x.name);
    assert.deepEqual(Object.keys(receipt.result),names,'RESULT_FIELDS_OR_ORDER');
    assert.deepEqual(Object.keys(receipt.field_status),names,'STATUS_FIELDS_OR_ORDER');
    for(const name of names){
      assert.equal(receipt.field_status[name],'ok','FIELD_NOT_OK:'+name);
      assert.deepEqual(receipt.result[name],sourceCapture.provider.body[name],'VALUE_MISMATCH:'+name);
    }
    assert(/^0x[0-9a-f]{64}$/i.test(receipt.signal_hash??''),'SIGNAL_HASH_REQUIRED');
    report.pass=true;report.signal_hash=receipt.signal_hash;report.six_decimal_exact=proof.reference.six_decimal_exact;
    report.raw_metadata_versions_match_live_contract=proof.raw_metadata_versions_match_live_contract;
  }catch(e){report.failures.push(e.message.split('\n')[0]);}
  return report;
}
