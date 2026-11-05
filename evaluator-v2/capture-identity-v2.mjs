// Optional development preflight. Frozen scorers and benchmark results are unchanged.
import {deriveOutcome} from './evidence.mjs';
import {checkAnswerEnvelope} from './answer-envelope.mjs';
const policy='strict_capture_identity_v2';
const HASH=/^0x[0-9a-f]{64}$/i,ADDRESS=/^0x[0-9a-f]{40}$/i,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const refuse=refusal=>({valid:false,policy,refusal,cryptographic_inclusion_proof:false});
export function checkAnswerWithCaptureIdentity(request,evidence,candidate){
  // Preserve existing chain, state, numeric-domain and missing-evidence refusals.
  try{deriveOutcome(request,evidence);}catch(error){return refuse(error.code??'INVALID_EVIDENCE');}
  const {transaction:tx,receipt,block}=evidence;
  if(!ADDRESS.test(receipt.from??'')||!ADDRESS.test(receipt.to??''))return refuse('MISSING_RECEIPT_IDENTITIES');
  if(!same(receipt.from,tx.from)||!same(receipt.to,tx.to))return refuse('CONFLICTING_RECEIPT_IDENTITIES');
  // This version deliberately requires an RPC block fetched with full=false.
  // Other witnesses need a separately reviewed policy, never guessed conversion.
  const members=block.transactions;
  if(!Array.isArray(members)||members.length>50000||members.some(x=>typeof x!=='string'||!HASH.test(x)))return refuse('MISSING_OR_UNSUPPORTED_BLOCK_MEMBERSHIP');
  const normalized=members.map(x=>x.toLowerCase());
  if(new Set(normalized).size!==members.length||!normalized.includes(tx.hash.toLowerCase()))return refuse('CONFLICTING_BLOCK_MEMBERSHIP');
  if(typeof tx.transactionIndex!=='string'||typeof receipt.transactionIndex!=='string'||!QUANTITY.test(tx.transactionIndex)||!QUANTITY.test(receipt.transactionIndex))return refuse('MISSING_TRANSACTION_INDEX');
  const index=BigInt(tx.transactionIndex);
  if(index!==BigInt(receipt.transactionIndex)||index>=BigInt(members.length)||!same(members[Number(index)],tx.hash))return refuse('CONFLICTING_TRANSACTION_INDEX');
  const result=checkAnswerEnvelope(request,evidence,candidate);
  return {...result,answer_policy:result.policy,policy,cryptographic_inclusion_proof:false};
}
