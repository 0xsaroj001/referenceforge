// Original, offline evidence audit. This is not an Anjoman scoring adapter.
import { isDeepStrictEqual } from 'node:util';
export const INTENT = 'ONCHAIN_TX_LOOKUP_GENERAL';
export const CHAIN_IDS = Object.freeze({ base: 8453n, base_sepolia: 84532n });
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function quantity(value, code = 'MALFORMED_QUANTITY') {
  if (typeof value !== 'string' || !QUANTITY.test(value)) fail(code);
  return BigInt(value);
}

export function deriveOutcome(request, evidence) {
  if (!request || !HASH.test(request.tx_hash ?? '') || !Object.hasOwn(CHAIN_IDS, request.chain)) fail('INVALID_REQUEST');
  if (!evidence || evidence.rpc_error || evidence.transport_error) fail('UPSTREAM_FAILURE');
  if (quantity(evidence.chain_id) !== CHAIN_IDS[request.chain]) fail('WRONG_CHAIN');
  const { transaction: tx, receipt, block } = evidence;
  if (tx === null && receipt === null) fail('ABSENCE_NOT_PROOF');
  if (!tx || !HASH.test(tx.hash ?? '') || !same(tx.hash, request.tx_hash)) fail('WRONG_TRANSACTION');
  if (tx.blockNumber === null && tx.blockHash === null && receipt === null) fail('PENDING_NUMERIC_SCHEMA_GAP');
  if (!receipt || !block) fail('INCOMPLETE_EVIDENCE');
  if (!same(receipt.transactionHash, request.tx_hash)) fail('WRONG_RECEIPT');
  if (![tx.blockHash, receipt.blockHash, block.hash].every(x => HASH.test(x ?? '')) ||
      !same(tx.blockHash, receipt.blockHash) || !same(receipt.blockHash, block.hash)) fail('NONCANONICAL_BLOCK');
  const height = quantity(receipt.blockNumber);
  if (quantity(tx.blockNumber) !== height || quantity(block.number) !== height) fail('BLOCK_HEIGHT_MISMATCH');
  if (height > 1_000_000_000_000n) fail('BLOCK_OUT_OF_SCHEMA_RANGE');
  if (!ADDRESS.test(tx.from ?? '') || (tx.to !== null && !ADDRESS.test(tx.to ?? ''))) fail('INVALID_ADDRESS');
  // The live v4 response says string, without declaring null for contract creation.
  if (tx.to === null) fail('CONTRACT_CREATION_SCHEMA_GAP');
  if (receipt.status !== '0x0' && receipt.status !== '0x1') fail('INVALID_RECEIPT_STATUS');
  const wei = quantity(tx.value);
  if (wei % 1_000_000_000_000n !== 0n || wei > 1_000_000_000_000n * 10n ** 18n) fail('VALUE_PRECISION_OR_RANGE');
  // Avoid conflating attempted transaction value with successfully transferred value.
  if (receipt.status === '0x0' && wei !== 0n) fail('REVERTED_VALUE_SEMANTICS_GAP');
  const micros = wei / 1_000_000_000_000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) fail('VALUE_PRECISION_OR_RANGE');
  const value = Number(micros) / 1_000_000;
  if (BigInt(value.toFixed(6).replace('.', '')) !== micros) fail('VALUE_PRECISION_OR_RANGE');
  return { tx_hash: request.tx_hash, status: receipt.status === '0x1' ? 'confirmed' : 'reverted',
    from: tx.from, to: tx.to, block_number: Number(height), value_eth: value };
}

export function checkAnswer(request, evidence, candidate) {
  let expected;
  try { expected = deriveOutcome(request, evidence); } catch (error) { return { valid: false, refusal: error.code }; }
  let answer;
  try { answer = typeof candidate === 'string' ? JSON.parse(candidate) : candidate; }
  catch { return { valid: false, reasons: ['INVALID_JSON'] }; }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { valid: false, reasons: ['INVALID_OBJECT'] };
  const reasons = [];
  for (const field of ['tx_hash', 'from', 'to']) if (!same(answer[field], expected[field])) reasons.push(field);
  for (const field of ['status', 'block_number', 'value_eth']) if (answer[field] !== expected[field]) reasons.push(field);
  if (typeof answer.block_number !== 'number' || !Number.isInteger(answer.block_number)) reasons.push('NUMERIC_BLOCK_REQUIRED');
  if (typeof answer.value_eth !== 'number' || !Number.isFinite(answer.value_eth)) reasons.push('NUMERIC_VALUE_REQUIRED');
  return { valid: reasons.length === 0, reasons };
}

export function auditCase(item) {
  if (typeof item.prompt !== 'string' || !item.prompt.includes(JSON.stringify(item.request)) ||
      !item.prompt.includes(JSON.stringify(item.evidence))) fail('PROMPT_EVIDENCE_MISMATCH');
  const actual = deriveOutcome(item.request, item.evidence);
  if (!isDeepStrictEqual(actual, item.expected)) fail('GOLD_ORACLE_MISMATCH');
  if (!checkAnswer(item.request, item.evidence, item.chosen).valid) fail('INVALID_CHOSEN');
  if (checkAnswer(item.request, item.evidence, item.rejected).valid) fail('INVALID_REJECTED');
  if (typeof item.scenario !== 'string' || !item.scenario) fail('MISSING_SCENARIO');
  return true;
}
