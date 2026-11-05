import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {boundedText} from '../../src/onchain/rpc.mjs';
export const V2_VALIDATION_ENDPOINT='https://anjoman.ai/api/registrations/validate';
export const bytesHash=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
export function checkCanonicalAnswer(body,contract){
  assert(body&&typeof body==='object'&&body.provider_status==='ok','Provider did not return an attributed answer');
  assert.equal(body.intent,contract.intent);assert.equal(body.request_schema_version,contract.request.schema_version);assert.equal(body.response_format_version,contract.response.format_version);
  const evidence=body.evidence;assert(evidence&&evidence.status==='ok'&&evidence.verified_answer!==false&&evidence.fallback!==true,'Original evidence missing or unverified');
  if(contract.intent==='MACRO_ECONOMIC_INDICATOR_GENERAL'){
    assert(evidence.indicator_id==='SL.UEM.TOTL.ZS'&&/^https:\/\/api\.worldbank\.org\//.test(evidence.source?.source_url)&&/^[a-f0-9]{64}$/.test(evidence.source?.payload_sha256),'Macro source attribution missing');
  }else if(['ONCHAIN_TX_LOOKUP_GENERAL','WALLET_BALANCE_CHECK_GENERAL'].includes(contract.intent)){
    assert(evidence.verified_answer===true&&evidence.verification?.method==='two_operator_exact_agreement'&&evidence.verification.sources?.length===2,'Dual RPC evidence missing');
  }else assert(evidence.verified_answer===true&&evidence.fallback===false&&evidence.sources?.length>=2,'Weather source attribution missing');
  assert(!Object.hasOwn(body,'field_status'),'Provider cannot fabricate node field statuses');
  for(const field of contract.response.fields){
    const value=body[field.name];assert(value!==undefined&&value!==null,'Missing canonical field '+field.name);
    if(field.type==='number'){assert(typeof value==='number'&&Number.isFinite(value),'Canonical numeric field must be finite JSON number: '+field.name);if(field.range)assert(value>=field.range[0]&&value<=field.range[1],'Canonical range violation '+field.name);if(field.decimals===0)assert(Number.isSafeInteger(value),'Canonical integer field invalid');}
    else if(field.type==='enum')assert(field.allowed.includes(value),'Canonical enum invalid');
    else assert(typeof value==='string','Canonical text field invalid');
  }
  return {intent:contract.intent,response_format_version:body.response_format_version,fields:contract.response.fields.map(x=>x.name),scope:'Provider-field conformance, not node shaping/admission'};
}
export function checkDescriptorContracts(descriptor,contracts){
  assert.equal(descriptor.version,'1');assert.equal(descriptor.kind,'miner');assert.equal(descriptor.auth.type,'none');
  assert.equal(descriptor.slug,'referenceforge-numeric');assert.equal(descriptor.id,1900999000);
  assert.deepEqual([...descriptor.semantics.supported_intents].sort(),contracts.map(x=>x.intent).sort());
  for(const c of contracts){
    const m=descriptor.intent_mapping[c.intent],ep=descriptor.endpoints.find(x=>x.path===m?.endpoint);assert(ep&&ep.intents.includes(c.intent),'Mapping endpoint not declared');
    assert.deepEqual(Object.keys(m.input).sort(),c.request.params.map(p=>p.name).sort(),'Canonical input mapping mismatch');
    assert.deepEqual(Object.keys(m.output).sort(),c.response.fields.map(f=>f.name).sort(),'Canonical output mapping mismatch');
    for(const f of c.response.fields){assert.equal(m.output[f.name].path,f.name);if(f.type==='number')assert.equal(m.output[f.name].unit,f.unit,'Do not guess unit conversions');}
    assert.deepEqual(ep.params.query.required.map(p=>p.name).sort(),c.request.params.filter(p=>p.required).map(p=>p.name).sort());
  }
  return {contracts:contracts.length,status:'local_contract_checks_passed',official_platform_schema_validated:false};
}
export function checkPlatformValidation(status,body,descriptor){
  assert.equal(status,200,'Platform validation unavailable or authentication required');
  assert(body&&body.valid===true,'Platform rejected descriptor');assert.equal(body.slug,descriptor.slug,'Validation identity mismatch');assert.equal(body.name,descriptor.name,'Validation name mismatch');
  assert(!body.errors?.length&&!body.conflicts?.length,'Platform validation errors/conflicts remain');
  assert(Array.isArray(body.results)&&body.results.length===descriptor.endpoints.length,'Incomplete endpoint validation');
  const expected=new Set(descriptor.endpoints.map(x=>x.path));
  for(const row of body.results){assert(expected.delete(row.path),'Unknown or duplicate endpoint result');assert(row.method==='GET'&&row.success===true&&row.status>=200&&row.status<300,'Reachable error is not a fulfilled endpoint');}
  assert.equal(expected.size,0);return true;
}
export async function postPlatformValidation(yaml,{fetchImpl=fetch,authorization}={}){
  assert(typeof yaml==='string'&&Buffer.byteLength(yaml)<=128000,'Descriptor exceeds local request bound');
  assert(authorization===undefined||typeof authorization==='string'&&authorization.startsWith('Bearer ')&&!/[\r\n]/.test(authorization),'Invalid authorization header');
  const signal=AbortSignal.timeout(20000),response=await fetchImpl(V2_VALIDATION_ENDPOINT,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify({yaml})});
  const raw=await boundedText(response,256000,signal);let body;try{body=JSON.parse(raw);}catch{body={error:'NON_JSON_VALIDATION_RESPONSE'};}
  return {status:response.status,body};
}
