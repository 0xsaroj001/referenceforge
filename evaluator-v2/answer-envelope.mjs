// Optional, conservative local policy. The frozen field audit is unchanged.
// This accepts canonical answer objects only, never raw Provider metadata.
import {checkAnswer} from './evidence.mjs';
export const ANSWER_FIELDS=Object.freeze(['tx_hash','status','from','to','block_number','value_eth']);
const allowed=new Set(ANSWER_FIELDS),policy='canonical_answer_envelope_v1';
const refusal=reason=>({valid:false,policy,reasons:[reason],scope:'Local answer-envelope policy; no node admission or truth claim for unsupported fields'});
function duplicateKeys(raw){
  let depth=0;const keys=new Set();
  for(let i=0;i<raw.length;i++){
    if(raw[i]==='"'){
      const start=i++;for(;i<raw.length;i++){if(raw[i]==='\\')i++;else if(raw[i]==='"')break;}
      let next=i+1;while(next<raw.length&&/\s/.test(raw[next]))next++;
      if(depth===1&&raw[next]===':'){const key=JSON.parse(raw.slice(start,i+1));if(keys.has(key))return true;keys.add(key);}
    }else if(raw[i]==='{'||raw[i]==='[')depth++;else if(raw[i]==='}'||raw[i]===']')depth--;
  }
  return false;
}
export function checkAnswerEnvelope(request,evidence,candidate){
  let answer=candidate;
  if(typeof candidate==='string'){
    if(Buffer.byteLength(candidate,'utf8')>32768)return refusal('ANSWER_TOO_LARGE');
    try{answer=JSON.parse(candidate);if(duplicateKeys(candidate))return refusal('DUPLICATE_ANSWER_FIELD');}catch{return refusal('INVALID_JSON');}
  }
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return refusal('INVALID_OBJECT');
  const proto=Object.getPrototypeOf(answer);if(proto!==Object.prototype&&proto!==null)return refusal('NON_PLAIN_ANSWER');
  const keys=Reflect.ownKeys(answer);
  if(keys.some(key=>typeof key!=='string'||!allowed.has(key)))return refusal('UNSUPPORTED_ANSWER_FIELDS');
  if(keys.length!==ANSWER_FIELDS.length||ANSWER_FIELDS.some(key=>!Object.hasOwn(answer,key)))return refusal('MISSING_ANSWER_FIELDS');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(answer,key);if(d.get||d.set||!d.enumerable)return refusal('NON_DATA_ANSWER_FIELD');if(typeof d.value!=='string'&&typeof d.value!=='number')return refusal('NON_SCALAR_ANSWER_FIELD');}
  return {...checkAnswer(request,evidence,answer),policy};
}
