// Adds an explicit transaction-chain witness to the reviewed v2 identity policy.
// v2, its frozen review, corpus and benchmark scorers remain byte-for-byte unchanged.
import {checkAnswerWithCaptureIdentity} from './capture-identity-v2.mjs';
import {CHAIN_IDS} from './evidence.mjs';
const policy='strict_capture_chain_v3',quantity=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
export function checkAnswerWithCaptureChain(request,evidence,candidate){
  const prior=checkAnswerWithCaptureIdentity(request,evidence,candidate);
  if(!prior.valid)return {...prior,identity_policy:prior.policy,policy};
  const declared=evidence.transaction.chainId;
  if(typeof declared!=='string'||!quantity.test(declared))return {valid:false,policy,refusal:'MISSING_OR_MALFORMED_TRANSACTION_CHAIN',cryptographic_inclusion_proof:false};
  if(BigInt(declared)!==CHAIN_IDS[request.chain])return {valid:false,policy,refusal:'CONFLICTING_TRANSACTION_CHAIN',cryptographic_inclusion_proof:false};
  return {...prior,identity_policy:prior.policy,policy,transaction_chain_checked:true};
}
