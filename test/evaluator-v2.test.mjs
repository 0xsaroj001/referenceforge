import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOutcome, checkAnswer, auditCase, INTENT } from '../evaluator-v2/evidence.mjs';
import { normalize, provenanceClass, validateJsonl, makeRow, maximumPromptSimilarity } from '../evaluator-v2/pool.mjs';
import { auditCatalog } from '../evaluator-v2/audit.mjs';

// Public unit-test fixture, deliberately separate from the unpublished question pack.
const hash = '0x' + 'ab'.repeat(32), blockHash = '0x' + 'cd'.repeat(32);
const from = '0x' + '12'.repeat(20), to = '0x' + '34'.repeat(20);
function fixture() {
  const request = { tx_hash: hash, chain: 'base' };
  const evidence = { chain_id: '0x2105',
    transaction: { hash, from, to, blockHash, blockNumber: '0xabc', value: '0xde0b6b3a7640000' },
    receipt: { transactionHash: hash, blockHash, blockNumber: '0xabc', status: '0x1' },
    block: { hash: blockHash, number: '0xabc' } };
  const expected = { tx_hash: hash, status: 'confirmed', from, to, block_number: 2748, value_eth: 1 };
  return { id: 'public-unit-sample', scenario: 'receipt-success', request, evidence, expected,
    prompt: 'Public synthetic unit sample: classify the captured transaction receipt. Request: ' + JSON.stringify(request) + '. Evidence: ' + JSON.stringify(evidence),
    chosen: JSON.stringify(expected), rejected: JSON.stringify({ ...expected, status: 'reverted' }) };
}
const stringify = row => JSON.stringify(row) + '\n';
test('evaluator v2 maps an exact mined result and native value independently of gas', () => {
  const item = fixture(); item.evidence.receipt.gasUsed = '0xffff';
  assert.deepEqual(deriveOutcome(item.request, item.evidence), item.expected);
});
test('evaluator v2 maps receipt failure to reverted for unambiguous zero value', () => {
  const item = fixture(); item.evidence.receipt.status = '0x0'; item.evidence.transaction.value = '0x0';
  assert.equal(deriveOutcome(item.request, item.evidence).status, 'reverted');
});
for (const [name, change, code] of [
  ['unsupported chain', x => x.request.chain = 'ethereum', 'INVALID_REQUEST'],
  ['upstream RPC failure', x => x.evidence.rpc_error = { code: -32000 }, 'UPSTREAM_FAILURE'],
  ['wrong chain', x => x.evidence.chain_id = '0x1', 'WRONG_CHAIN'],
  ['missing transaction', x => x.evidence.transaction = null, 'WRONG_TRANSACTION'],
  ['absence', x => { x.evidence.transaction = null; x.evidence.receipt = null; }, 'ABSENCE_NOT_PROOF'],
  ['pending', x => { x.evidence.transaction.blockNumber = null; x.evidence.transaction.blockHash = null; x.evidence.receipt = null; }, 'PENDING_NUMERIC_SCHEMA_GAP'],
  ['missing receipt', x => x.evidence.receipt = null, 'INCOMPLETE_EVIDENCE'],
  ['wrong receipt identity', x => x.evidence.receipt.transactionHash = '0x' + 'ef'.repeat(32), 'WRONG_RECEIPT'],
  ['mismatched observed block', x => x.evidence.block.hash = '0x' + '00'.repeat(32), 'NONCANONICAL_BLOCK'],
  ['height disagreement', x => x.evidence.block.number = '0xabd', 'BLOCK_HEIGHT_MISMATCH'],
  ['noncanonical quantity', x => x.evidence.receipt.blockNumber = '0x0abc', 'MALFORMED_QUANTITY'],
  ['invalid sender', x => x.evidence.transaction.from = '0x123', 'INVALID_ADDRESS'],
  ['contract creation', x => x.evidence.transaction.to = null, 'CONTRACT_CREATION_SCHEMA_GAP'],
  ['unknown receipt code', x => x.evidence.receipt.status = '0x2', 'INVALID_RECEIPT_STATUS'],
  ['sub-six-decimal value', x => x.evidence.transaction.value = '0x1', 'VALUE_PRECISION_OR_RANGE'],
  ['attempted value on revert', x => x.evidence.receipt.status = '0x0', 'REVERTED_VALUE_SEMANTICS_GAP'],
  ['unsafe micros', x => x.evidence.transaction.value = '0x' + ((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 10n ** 12n).toString(16), 'VALUE_PRECISION_OR_RANGE'],
]) test('evaluator v2 refuses ' + name, () => {
  const item = fixture(); change(item);
  assert.throws(() => deriveOutcome(item.request, item.evidence), { code });
});
test('evaluator v2 audits fixed gold, chosen and rejected independently', () => {
  const item = fixture(); assert.equal(auditCase(item), true);
  item.expected.block_number = 2749;
  assert.throws(() => auditCase(item), { code: 'GOLD_ORACLE_MISMATCH' });
});
test('evaluator v2 refuses a numeric output that loses one micro-unit on conversion', () => {
  const item = fixture();
  item.evidence.transaction.value = '0x' + (BigInt(Number.MAX_SAFE_INTEGER) * 10n ** 12n).toString(16);
  assert.throws(() => deriveOutcome(item.request, item.evidence), { code: 'VALUE_PRECISION_OR_RANGE' });
});
test('evaluator v2 refuses a catalog whose prompt does not carry its audited evidence', () => {
  const item = fixture(); item.prompt = 'A different transaction is described by this unrelated prompt.';
  assert.throws(() => auditCase(item), { code: 'PROMPT_EVIDENCE_MISMATCH' });
});
test('evaluator v2 rejects JSON syntax, string block and wrong address answers', () => {
  const item = fixture();
  assert.equal(checkAnswer(item.request, item.evidence, 'broken').valid, false);
  assert.equal(checkAnswer(item.request, item.evidence, { ...item.expected, block_number: '2748' }).valid, false);
  assert.equal(checkAnswer(item.request, item.evidence, { ...item.expected, to: from }).valid, false);
  assert.equal(checkAnswer(item.request, item.evidence, { ...item.expected, tx_hash: hash.toUpperCase() }).valid, true);
});
test('evaluator v2 produces documented preference-pair fields', () => {
  const row = makeRow(fixture()), result = validateJsonl(stringify(row));
  assert.equal(result.valid, true); assert.deepEqual(result.provenance, { unverified: 1 });
  assert.equal(row.label_kind, 'preference_pair'); assert.equal(row.intent_id, INTENT);
});
test('evaluator v2 synthetic provenance never becomes attested through a URL', () => {
  for (const source_kind of ['synthetic', 'llm', 'generated', 'model']) assert.equal(provenanceClass({ source_kind, source_url: 'https://example.org' }), 'unverified');
});
test('evaluator v2 implements Unicode NFC and whitespace prompt identity', () => {
  assert.equal(normalize(' cafe\u0301\n  task '), 'café task');
  const row = makeRow(fixture()); const second = { ...row, prompt: '  ' + row.prompt + '  ' };
  const result = validateJsonl(stringify(row) + stringify(second));
  assert(result.errors.some(e => e.message === 'DUPLICATE_PROMPT'));
});
for (const [name, change, code] of [
  ['wrong intent', r => r.intent_id = 'WEATHER_CHECK_TEMPERATURE', 'INTENT_MISMATCH'],
  ['truth source mixed into pair', r => r.source = {}, 'UNEXPECTED_TRUTH_SOURCE'],
  ['unknown label', r => r.label_kind = 'truth_source', 'UNSUPPORTED_LABEL_KIND'],
  ['empty question', r => r.prompt = '  ', 'LENGTH_PROMPT'],
  ['missing rejection', r => delete r.rejected, 'INVALID_REJECTED'],
  ['identical answer', r => r.rejected = ' ' + r.chosen, 'IDENTICAL_ANSWERS'],
  ['NUL in decoded answer', r => r.chosen += '\u0000', 'CONTROL_CHARS_CHOSEN'],
  ['row byte limit', r => r.extra = 'a'.repeat(65536), 'ROW_TOO_LARGE'],
]) test('evaluator v2 preflight rejects ' + name, () => {
  const row = makeRow(fixture()); change(row);
  const result = validateJsonl(stringify(row)); assert.equal(result.valid, false);
  assert(result.errors.some(e => e.message === code));
});
test('evaluator v2 preflight preserves non-pair optional rejection rules', () => {
  const row = { ...makeRow(fixture()), label_kind: 'ground_truth' }; delete row.rejected;
  assert.equal(validateJsonl(stringify(row)).valid, true);
});
test('evaluator v2 detects malformed UTF8 and body over documented default', () => {
  assert.equal(validateJsonl(Buffer.from([0xc3, 0x28])).errors[0].message, 'INVALID_UTF8');
  assert.equal(validateJsonl(Buffer.alloc(32 * 1024 * 1024 + 1)).errors[0].message, 'BODY_TOO_LARGE');
});
test('evaluator v2 reports exact prompt similarity without claiming node curation', () => {
  const row = makeRow(fixture());
  assert.equal(maximumPromptSimilarity([row, row]).max_similarity, 1);
  assert.equal(maximumPromptSimilarity([row]).max_similarity, 0);
});
test('evaluator v2 catalog audit excludes refusal examples from pool material', async () => {
  const good = fixture(), guard = fixture(); guard.evidence.receipt = null;
  const result = await auditCatalog({ pairs: [good], refusals: [{ ...guard, id: 'no-receipt', expected_refusal: 'INCOMPLETE_EVIDENCE' }] });
  assert.equal(result.report.paired_cases, 1); assert.equal(result.report.refusal_cases, 1);
  assert.equal(result.jsonl.trim().split('\n').length, 1);
  assert.equal(result.report.admitted, false); assert.equal(result.report.adapter_built, false);
});
test('evaluator v2 catalog rejects invalid gold and duplicate case IDs', async () => {
  await assert.rejects(auditCatalog({ pairs: [fixture(), fixture()], refusals: [] }), /DUPLICATE_CASE_ID/);
  const item = fixture(); item.chosen = item.rejected;
  await assert.rejects(auditCatalog({ pairs: [item], refusals: [] }), /INVALID_CHOSEN/);
});
