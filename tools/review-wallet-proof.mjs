// Offline adapter for a separately frozen, synthetic second-model challenge spec.
// No network/account access and no edits to the checker or expected labels.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {assessWalletProof} from './lib/wallet-proof.mjs';
import {walletProofFixture} from '../test/fixtures/wallet-proof.mjs';
import {parseUniqueJson} from '../evaluator-v2/strict-json.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const relative='reports/wallet-proof-2026-11-03/';
const corpusPath=resolve(root,relative,'reviewer-challenges.json');
const frozenSha='63de00e07bdce90bfb3ce85a5300d8046c595dec5de252f66c2f64cd7c50c967';
const corpusBytes=await readFile(corpusPath);
assert.equal(sha(corpusBytes),frozenSha,'FROZEN_CHALLENGE_CHANGED');
const spec=parseUniqueJson(corpusBytes.toString('utf8'));
assert.equal(spec.challenges.length,12);

const dependencies=['tools/lib/wallet-proof.mjs','tools/wallet-proof.mjs','test/fixtures/wallet-proof.mjs',
  'evaluator-v2/strict-json.mjs','tools/review-wallet-proof.mjs'];
const dependencyHashes=Object.fromEntries(await Promise.all(dependencies.map(async path=>[path,sha(await readFile(resolve(root,path)))])));
let revision;
try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();}
catch{revision='unavailable';}

function mappedTime(value,mode){
  assert.equal(typeof value,'string','MISSING_FROZEN_TIME');
  assert(Number.isFinite(Date.parse(value)),'BAD_FROZEN_TIME');
  const output=value;
  assert.equal(Date.parse(output),Date.parse(value),'TIME_INSTANT_CHANGED');
  return output;
}
const seconds=value=>{
  const ms=Date.parse(value);assert(Number.isSafeInteger(ms)&&ms%1000===0,'SUBSECOND_HEADER_NOT_EXPRESSIBLE');
  return BigInt(ms/1000);
};
const header=value=>({hash:value.hash,number:value.number,timestamp:'0x'+seconds(value.timestamp_utc).toString(16)});
function numericLexeme(raw){
  const all=[...raw.matchAll(/"balance"\s*:\s*(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)(?=\s*[,}])/g)];
  assert.equal(all.length,1,'UNIQUE_RAW_BALANCE_LEXEME_REQUIRED');return all[0][1];
}
// Independent decimal arithmetic used only for mapping diagnostics, never to
// repair the checker's input or override its result.
function exactLexemeWei(text){
  const m=text.match(/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/);
  assert(m,'INVALID_DECIMAL_LEXEME');
  let digits=BigInt(m[2]+(m[3]??''));if(m[1])digits=-digits;
  const exp=18+Number(m[4]??0)-(m[3]??'').length;
  if(exp>=0)return (digits*10n**BigInt(exp)).toString();
  const divisor=10n**BigInt(-exp);assert(digits%divisor===0n,'SUB_WEI_LEXEME');
  return (digits/divisor).toString();
}

function adapt(frozen,mode){
  if(mode==='verbatim_answer_json')throw Error('Frozen raw answer JSON and disclosed evidence are separate semantic projections; checker requires both in one identical raw/parsed envelope. No frozen source repair performed in strict mode.');
  const f=structuredClone(frozen),envelope=walletProofFixture();
  // Fixture import supplies only valid unrelated contract/refusal envelopes.
  // Provider, request, references and clock are constructed anew from frozen
  // fields; no fixture wallet, amount, anchor or timestamp is retained.
  const body=parseUniqueJson(f.provider.raw_response_json),e=f.provider.disclosed_evidence;
  const originalAsOf=body.as_of;
  body.as_of=mappedTime(body.as_of,mode);
  body.evidence={...structuredClone(e),unit:'ETH',
    balance:e.balance_whole_eth_decimal,value_raw:e.balance_wei,
    observed_at:mappedTime(e.observed_at,mode),
    block:{...structuredClone(e.block),number:BigInt(e.block.number).toString(),timestamp:seconds(e.block.timestamp_utc).toString()}};
  // The corpus intentionally stores answer JSON and semantic evidence separately.
  // This explicit synthetic shape adaptation appends mapped evidence to the raw
  // answer object without serializing or modifying ANY original answer token.
  const originalRaw=f.provider.raw_response_json;
  assert(originalRaw.endsWith('}'),'UNEXPECTED_FROZEN_RAW_SHAPE');
  const composedRaw=originalRaw.slice(0,-1)+',"evidence":'+JSON.stringify(body.evidence)+'}';
  assert.deepEqual(parseUniqueJson(composedRaw),body,'COMPOSED_BODY_DIFFERS');
  const capture={synthetic:true,checked_at:mappedTime(f.clock.verification_now,mode),
    input:{chain:f.request.chain,address:f.request.address},contract:structuredClone(envelope.contract),
    provider:{status:f.provider.http_status,raw_body:composedRaw,body,frozen_answer_json:originalRaw},
    references:f.reference_operators.map(row=>{
      const block=header(row.block_at_disclosed_number);
      const mapped={source:row.fixed_endpoint,chain_id:row.chain_id_hex,
        block,canonical_after:structuredClone(block),
        head:{number:row.observed_head_number,
          // Supplemental synthetic header fields absent from semantic corpus:
          // deterministic fabricated hash, observed-at instant for head time.
          hash:'0x'+sha(row.operator_id+'|'+row.observed_head_number+'|synthetic-review-head'),
          timestamp:'0x'+seconds(e.observed_at).toString(16)},
        query:structuredClone(row.balance_request),balance_wei:row.balance_result_hex,
        completed_at:mappedTime(f.clock.verification_now,mode),http_status:row.http_status};
      if(row.http_status!==200||row.rpc_error) mapped.error=row.rpc_error??'HTTP_'+row.http_status;
      return mapped;
    }),refusals:structuredClone(envelope.refusals)};

  assert.equal(capture.input.address,f.request.address,'REQUEST_ADDRESS_OVERWRITTEN');
  assert.equal(capture.input.chain,f.request.chain,'REQUEST_CHAIN_OVERWRITTEN');
  assert.equal(capture.provider.frozen_answer_json,f.provider.raw_response_json,'FROZEN_RAW_JSON_CHANGED');
  assert.equal(capture.provider.raw_body.slice(0,originalRaw.length-1),originalRaw.slice(0,-1),'RAW_ANSWER_PREFIX_CHANGED');
  const {evidence:appended,...composedAnswer}=parseUniqueJson(capture.provider.raw_body);
  assert.deepEqual(composedAnswer,parseUniqueJson(originalRaw),'FROZEN_ANSWER_FIELD_CHANGED');
  assert.equal(numericLexeme(capture.provider.raw_body),numericLexeme(f.provider.raw_response_json),'NUMERIC_TOKEN_CHANGED');
  for(const field of ['network','chain_id','address','token','token_decimals','verified_answer'])
    assert.deepEqual(body.evidence[field],e[field],'EVIDENCE_FIELD_CHANGED:'+field);
  assert.equal(body.evidence.value_raw,e.balance_wei,'RAW_WEI_CHANGED');
  assert.equal(body.evidence.balance,e.balance_whole_eth_decimal,'DECIMAL_BALANCE_CHANGED');
  assert.equal(body.evidence.block.hash,e.block.hash,'ANCHOR_HASH_CHANGED');
  assert.equal(BigInt(body.evidence.block.number),BigInt(e.block.number),'ANCHOR_HEIGHT_CHANGED');
  assert.equal(body.evidence.block.timestamp,seconds(e.block.timestamp_utc).toString(),'ANCHOR_TIME_CHANGED');
  assert.equal(Date.parse(body.as_of),Date.parse(originalAsOf),'PROVIDER_TIME_CHANGED');
  assert.equal(Date.parse(capture.checked_at),Date.parse(f.clock.verification_now),'CLOCK_CHANGED');
  assert.equal(capture.references.length,f.reference_operators.length,'REFERENCE_CARDINALITY_CHANGED');
  capture.references.forEach((mapped,i)=>{
    const original=f.reference_operators[i];
    assert.equal(mapped.source,original.fixed_endpoint,'SOURCE_CHANGED');
    assert.equal(mapped.chain_id,original.chain_id_hex,'SOURCE_CHAIN_CHANGED');
    assert.deepEqual(mapped.query,original.balance_request,'HASH_PINNED_QUERY_CHANGED');
    assert.equal(mapped.balance_wei,original.balance_result_hex,'REFERENCE_BALANCE_CHANGED');
    assert.equal(mapped.block.hash,original.block_at_disclosed_number.hash,'REFERENCE_HASH_CHANGED');
    assert.equal(mapped.head.number,original.observed_head_number,'REFERENCE_HEAD_HEIGHT_CHANGED');
    assert.equal(BigInt(mapped.block.timestamp),seconds(original.block_at_disclosed_number.timestamp_utc),'REFERENCE_TIME_CHANGED');
  });
  const lexeme=numericLexeme(f.provider.raw_response_json);
  const rawWei=exactLexemeWei(lexeme),parsedWei=exactLexemeWei(String(body.balance));
  return {capture,mapping_diagnostics:{
    frozen_raw_response_sha256:sha(f.provider.raw_response_json),composed_raw_response_sha256:sha(composedRaw),raw_balance_lexeme:lexeme,
    parsed_number_string:String(body.balance),raw_lexeme_wei:rawWei,parsed_number_decimal_wei:parsedWei,
    number_parse_loses_decimal_value:rawWei!==parsedWei,
    frozen_identities_anchors_values_and_time_instants_preserved:true,
    timestamp_lexical_normalization:false,
    supplemental_fields:['evidence.unit ETH follows owning Provider native-amount semantics; balance_wei maps to value_raw',
      'reference.completed_at uses frozen verification clock','reference.canonical_after repeats frozen reference header synthetically',
      'reference.head.timestamp uses frozen observation instant','reference.head.hash is domain-separated synthetic hash; not observed',
      'contract and three unrelated 422 refusal controls copied from public-safe fixture',
      'mapped evidence appended to frozen answer JSON as a synthetic envelope; every original answer token retained verbatim']}};
}

const cases=spec.challenges.map(row=>({...row,origin:'frozen_primary'}));
const byId=new Map(spec.challenges.map(row=>[row.id,row]));
for(const invariant of spec.mandatory_cross_case_invariants){
  const original=byId.get(invariant.derived_from),fixture=structuredClone(original.fixture);
  if(invariant.id==='operator-unavailable'){
    fixture.reference_operators[1].http_status=503;
    fixture.reference_operators[1].rpc_error='HTTP_503';
    fixture.reference_operators[1].balance_result_hex=null;
  }else if(invariant.id==='reference-address-mismatch'){
    fixture.reference_operators[1].balance_request.params[0]=byId.get('wallet-review-04').fixture.provider.disclosed_evidence.address;
  }else if(invariant.id==='single-freshness-field'){
    const value=parseUniqueJson(fixture.provider.raw_response_json);
    value.as_of=fixture.clock.verification_now;
    fixture.provider.raw_response_json=JSON.stringify(value);
    fixture.provider.disclosed_evidence.observed_at=fixture.clock.verification_now;
  }else throw Error('UNKNOWN_FROZEN_INVARIANT');
  cases.push({id:invariant.id,title:invariant.mutation,origin:'frozen_derived_invariant',fixture,
    expected:{decision:'fail',reason:invariant.expected},derived_from:invariant.derived_from});
}

const rows=[];
const modes=['verbatim_answer_json','composed_evidence_verbatim_times'];
for(const mode of modes)for(const entry of cases){
  try{
    const adapted=adapt(entry.fixture,mode);
    const actual=assessWalletProof(adapted.capture);
    const matches=actual.pass===(entry.expected.decision==='pass');
    const masked=entry.expected.decision==='fail'&&actual.failures?.includes('MALFORMED_TIME');
    rows.push({id:entry.id,title:entry.title,origin:entry.origin,derived_from:entry.derived_from,mode,
      expected:entry.expected,actual,review_result:matches?'pass':'fail',
      target_gate_masked_by_timestamp_format:masked,mapping_diagnostics:adapted.mapping_diagnostics});
  }catch(error){rows.push({id:entry.id,mode,origin:entry.origin,expected:entry.expected,
    review_result:'not_run',reason:'Adapter could not express fixture without changing frozen values: '+error.message});}
}
assert.equal(sha(await readFile(corpusPath)),frozenSha,'CORPUS_MUTATED_DURING_REPLAY');
for(const [path,digest]of Object.entries(dependencyHashes))
  assert.equal(sha(await readFile(resolve(root,path))),digest,'DEPENDENCY_CHANGED_DURING_REPLAY:'+path);
const summaries=Object.fromEntries(modes.map(mode=>{
  const selected=rows.filter(row=>row.mode===mode);
  return [mode,{cases:selected.length,pass:selected.filter(row=>row.review_result==='pass').length,
    fail:selected.filter(row=>row.review_result==='fail').length,not_run:selected.filter(row=>row.review_result==='not_run').length,
    masked_by_timestamp_format:selected.filter(row=>row.target_gate_masked_by_timestamp_format).length}];
}));
const report={checked_at:new Date().toISOString(),kind:'second_model_synthetic_development_replay',
  corpus_sha256:frozenSha,git_head:revision,source_hashes:dependencyHashes,
  frozen_corpus_unchanged:true,network_calls:0,account_actions:0,
  not_independent_human_or_unseen_benchmark:true,platform_admission_verified:false,
  supersedes_adapter_attempt:'reviewer-replay-2026-11-03T16-12-54-916Z.json; that attempt retained answer-only raw JSON while attaching evidence to parsed body, so RAW_PROVIDER_BODY_MISMATCH masked all intended gates. Its aggregate invalid rejections are not coverage evidence.',
  mapping_policy:'Original adapter supplies semantic shape conversion and explicitly synthetic envelope fields; all specified challenge identities, quantities, raw numeric lexemes and time instants are asserted unchanged.',
  policy_differences:{reviewer_observation_max_age_seconds:120,checker_observation_max_age_seconds:60,
    reviewer_future_skew_seconds:5,checker_future_skew_seconds:10,
    interpretation:'Primary frozen cases use large stale/future deviations, so these threshold policies need not produce a result difference here. No threshold or expected label was silently tuned.'},
  metadata:'Raw version fields come from each frozen Provider JSON, not the fixture defaults. Contract schema and unrelated refusal controls use the fixture defaults; drift reporting is separate from five-value verification in the checker.',
  summaries,rows};
const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
const output=resolve(root,relative,'reviewer-replay-'+stamp+'.json');
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:output,corpus_sha256:frozenSha,source_hashes:dependencyHashes,summaries},null,2));
if(rows.some(row=>row.review_result!=='pass'))process.exitCode=1;
