// Original offline consistency policy for canonical native-wallet answers.
// Supplied JSON and distinct declared source hosts are not authenticated RPC
// responses, a cryptographic state proof, or a claim of operator independence.
import {parseUniqueJson} from './strict-json.mjs';

export const WALLET_INTENT = 'WALLET_BALANCE_CHECK_GENERAL';
export const WALLET_ANSWER_FIELDS = Object.freeze(['address', 'chain', 'balance', 'token_symbol', 'as_of']);
const POLICY = 'native_wallet_evidence_v1';
const CHAIN_IDS = Object.freeze({base: 8453n, base_sepolia: 84532n});
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const MAX_MICROS = BigInt(Number.MAX_SAFE_INTEGER);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const facts = Object.freeze({policy: POLICY, intent: WALLET_INTENT, source_authenticity_verified: false, source_operator_independence_verified: false, cryptographic_state_proof: false, finality_verified: false, current_freshness_verified: false});

// Copy only bounded own enumerable data properties. Do not invoke accessors,
// toJSON methods, inherited values, proxies intentionally, or custom prototypes.
// A malicious Proxy can throw during reflection; the caller then abstains.
function dataCopy(input) {
  let remaining = 512;
  function copy(value, depth) {
    if (--remaining < 0 || depth > 8) fail('INPUT_LIMIT');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { if (value.length > 16384) fail('INPUT_LIMIT'); return value; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('NONFINITE_INPUT'); return value; }
    if (!value || typeof value !== 'object') fail('NON_DATA_INPUT');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('NON_PLAIN_INPUT');
    const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (array) {
      const length = descriptors.length.value;
      if (length > 64 || keys.length !== length + 1 || keys.some(k => k !== 'length' && (typeof k !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(k) || Number(k) >= length))) fail('INVALID_ARRAY');
      return Array.from({length}, (_, index) => {
        const d = descriptors[index];
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('NON_DATA_INPUT');
        return copy(d.value, depth + 1);
      });
    }
    const out = Object.create(null);
    for (const key of keys) {
      const d = descriptors[key];
      if (typeof key !== 'string' || !Object.hasOwn(d, 'value') || !d.enumerable) fail('NON_DATA_INPUT');
      out[key] = copy(d.value, depth + 1);
    }
    return out;
  }
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > 65536) fail('INPUT_LIMIT');
    input = parseUniqueJson(input);
  }
  return copy(input, 0);
}
function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT');
  const keys = Object.keys(value), allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.has(key))) fail('UNEXPECTED_OR_MISSING_FIELDS');
}
function quantity(value, code = 'MALFORMED_QUANTITY') {
  if (typeof value !== 'string' || value.length > 66 || !QUANTITY.test(value)) fail(code);
  return BigInt(value);
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail('MALFORMED_TIMESTAMP');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail('MALFORMED_TIMESTAMP');
  return ms;
}
function sourceHost(value) {
  if (typeof value !== 'string' || value.length > 512) fail('INVALID_SOURCE');
  let url; try { url = new URL(value); } catch { fail('INVALID_SOURCE'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) fail('INVALID_SOURCE');
  return url.hostname.toLowerCase();
}
function exactBalance(wei) {
  // The response declares six decimals. This policy abstains instead of
  // rounding sub-micro ETH dust or accepting a lossy binary-number conversion.
  if (wei % 1_000_000_000_000n !== 0n) fail('BALANCE_PRECISION_GAP');
  const micros = wei / 1_000_000_000_000n;
  if (micros > MAX_MICROS) fail('BALANCE_PRECISION_GAP');
  const balance = Number(micros) / 1_000_000;
  if (!Number.isFinite(balance) || balance < 0 || balance > 1e15 || BigInt(balance.toFixed(6).replace('.', '')) !== micros) fail('BALANCE_PRECISION_GAP');
  return balance;
}

export function deriveWalletBalance(requestInput, evidenceInput) {
  const request = dataCopy(requestInput), evidence = dataCopy(evidenceInput);
  fields(request, ['chain', 'address'], ['token']);
  if (!Object.hasOwn(CHAIN_IDS, request.chain) || !ADDRESS.test(request.address ?? '')) fail('UNSUPPORTED_REQUEST');
  if (Object.hasOwn(request, 'token') && request.token !== '') fail('UNSUPPORTED_TOKEN');
  fields(evidence, ['observed_at', 'captures']);
  const observed = timestamp(evidence.observed_at);
  if (!Array.isArray(evidence.captures) || evidence.captures.length !== 2) fail('TWO_CAPTURES_REQUIRED');
  const captures = evidence.captures.map(capture => {
    fields(capture, ['source', 'chain_id', 'block', 'query', 'balance_wei', 'captured_at']);
    const host = sourceHost(capture.source);
    if (quantity(capture.chain_id) !== CHAIN_IDS[request.chain]) fail('WRONG_CHAIN');
    fields(capture.block, ['hash', 'number', 'timestamp']);
    if (!HASH.test(capture.block.hash ?? '')) fail('INVALID_BLOCK_HASH');
    const height = quantity(capture.block.number), blockSeconds = quantity(capture.block.timestamp);
    if (height > 1_000_000_000_000n || blockSeconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) fail('BLOCK_RANGE');
    const blockTime = Number(blockSeconds) * 1000, captured = timestamp(capture.captured_at);
    if (captured > observed || observed - captured > 60000 || blockTime > captured || observed - blockTime > 300000) fail('STALE_OR_FUTURE_EVIDENCE');
    fields(capture.query, ['address', 'block_hash', 'require_canonical']);
    if (!same(capture.query.address, request.address) || !same(capture.query.block_hash, capture.block.hash) || capture.query.require_canonical !== true) fail('UNBOUND_BALANCE_QUERY');
    const wei = quantity(capture.balance_wei);
    return {host, height, hash: capture.block.hash.toLowerCase(), blockSeconds, wei};
  });
  const [first, second] = captures;
  if (first.host === second.host) fail('DUPLICATE_DECLARED_SOURCE');
  if (first.height !== second.height || first.hash !== second.hash || first.blockSeconds !== second.blockSeconds) fail('BLOCK_DISAGREEMENT');
  if (first.wei !== second.wei) fail('BALANCE_DISAGREEMENT');
  return {address: request.address.toLowerCase(), chain: request.chain, balance: exactBalance(first.wei), token_symbol: 'ETH', as_of: evidence.observed_at};
}

export function checkWalletBalanceEvidence(request, evidence, candidate) {
  let expected;
  try { expected = deriveWalletBalance(request, evidence); }
  catch (error) { return {...facts, valid: false, outcome: 'abstain', refusal: error.code ?? 'MALFORMED_EVIDENCE'}; }
  let answer;
  try { answer = dataCopy(candidate); fields(answer, WALLET_ANSWER_FIELDS); }
  catch (error) { return {...facts, valid: false, outcome: 'reject', reasons: [error.code ?? 'MALFORMED_ANSWER']}; }
  const reasons = [];
  if (!same(answer.address, expected.address)) reasons.push('ADDRESS_MISMATCH');
  if (answer.chain !== expected.chain) reasons.push('CHAIN_MISMATCH');
  if (typeof answer.balance !== 'number' || !Number.isFinite(answer.balance) || Object.is(answer.balance, -0) || answer.balance !== expected.balance) reasons.push('BALANCE_MISMATCH');
  if (answer.token_symbol !== 'ETH') reasons.push('TOKEN_SYMBOL_MISMATCH');
  if (answer.as_of !== expected.as_of) reasons.push('AS_OF_MISMATCH');
  return {...facts, valid: reasons.length === 0, outcome: reasons.length ? 'reject' : 'accept', reasons};
}
