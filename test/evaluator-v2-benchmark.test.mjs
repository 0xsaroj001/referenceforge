import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSplit, benchmarkPairs, benchmarkGuards } from '../evaluator-v2/benchmark.mjs';
import { baselines, guardBaselines } from '../evaluator-v2/baselines.mjs';

const address = '0x' + '12'.repeat(20), hash = '0x' + 'ab'.repeat(32);
const good = { tx_hash: hash, status: 'confirmed', from: address, to: address, block_number: 40, value_eth: 0.125 };
const evidence = { chain_id: '0x2105', transaction: { hash, from: address, to: address, blockNumber: '0x28', value: '0x1bc16d674ec8000' }, receipt: { status: '0x1', blockNumber: '0x28' } };
const request = { chain: 'base', tx_hash: hash };
const pair = (preferred = 'left') => ({ id: 'fresh-case', failure_group: 'numeric-type', request, evidence,
  left: JSON.stringify(preferred === 'left' ? good : { ...good, block_number: '40' }),
  right: JSON.stringify(preferred === 'right' ? good : { ...good, block_number: '40' }), preferred });

test('evaluator benchmark rejects exact case and grouped failure-mode leakage', () => {
  assert.throws(() => validateSplit([{ id: 'old', scenario: 'numeric-type' }], [pair()]), /LEAKAGE/);
  assert.throws(() => validateSplit([{ id: 'fresh-case', scenario: 'other' }], [pair()]), /LEAKAGE/);
  assert.throws(() => validateSplit([], [pair(), pair()]), /INVALID_HOLDOUT/);
  validateSplit([{ id: 'dev-case', scenario: 'other-failure' }], [pair()]);
});
test('evaluator benchmark gives ties zero strict-ordering credit', () => {
  const result = benchmarkPairs([pair()], { constant: baselines.constant }).constant;
  assert.equal(result.ties, 1); assert.equal(result.correct, 0); assert.equal(result.strict_ordering_rate, 0);
});
test('evaluator benchmark respects balanced preferred positions', () => {
  const left = pair(), right = { ...pair('right'), id: 'second-case' };
  const result = benchmarkPairs([left, right], { shape: baselines.shape_only }).shape;
  assert.equal(result.correct, 2); assert.equal(result.reversed, 0); assert.equal(result.repeatable, true);
});
test('evaluator benchmark preserves reversed preferences as failures', () => {
  const result = benchmarkPairs([{ ...pair(), preferred: 'right' }], { shape: baselines.shape_only }).shape;
  assert.equal(result.reversed, 1); assert.equal(result.correct, 0);
});
test('evaluator scorer receives no gold label, competing answer or case annotation', () => {
  const item = { ...pair(), gold_reference: { secret: true }, label_basis: 'hidden-label' };
  let calls = 0;
  benchmarkPairs([item], { spy: { description: 'argument isolation', score: (...args) => {
    calls++; assert.equal(args.length, 3); assert.deepEqual(Object.keys(args[0]).sort(), ['chain', 'tx_hash']);
    assert.equal(args[1].gold_reference, undefined); assert.equal(args[1].preferred, undefined);
    assert.equal(typeof args[2], 'string'); return 0;
  } } });
  assert.equal(calls, 4);
});
test('evaluator benchmark reports nonrepeatable scorers without hiding the result', () => {
  let count = 0;
  const result = benchmarkPairs([pair()], { changing: { score: () => count++ } }).changing;
  assert.equal(result.repeatable, false);
});
test('evaluator benchmark rejects missing labels and nonfinite scoring', () => {
  assert.throws(() => benchmarkPairs([{ ...pair(), preferred: 'chosen' }], baselines), /INVALID_PAIR_LABEL/);
  assert.throws(() => benchmarkPairs([pair()], { broken: { score: () => NaN } }), /NONFINITE_SCORE/);
  assert.throws(() => benchmarkPairs([], baselines), /EMPTY_PAIR_BENCHMARK/);
});
test('evaluator shape and receipt baselines deliberately ignore value truth', () => {
  const wrong = JSON.stringify({ ...good, value_eth: 12 });
  assert.equal(baselines.shape_only.score(request, evidence, wrong), 1);
  assert.equal(baselines.receipt_status_only.score(request, evidence, wrong), 1);
  assert.equal(baselines.naive_fields.score(request, evidence, wrong), 0);
  assert.equal(baselines.naive_fields.score(request, evidence, JSON.stringify(good)), 1);
});
test('evaluator guard benchmark separates unsafe acceptance from needless refusal', () => {
  const controls = [{ id: 'good', failure_group: 'good', request, evidence, expected_accept: true },
    { id: 'wrong-chain', failure_group: 'wrong-chain', request, evidence: { ...evidence, chain_id: '0x1' }, expected_accept: false }];
  const result = benchmarkGuards(controls, { ...guardBaselines, always_refuse: { accept: () => false } });
  assert.equal(result.inclusion_only.unsafe_accepts, 1);
  assert.equal(result.chain_and_status.correct, 2);
  assert.equal(result.always_refuse.unnecessary_refusals, 1);
  assert.equal(result.always_refuse.correct, 1);
});
test('evaluator guard benchmark refuses missing truth and nonboolean candidates', () => {
  assert.throws(() => benchmarkGuards([{ request, evidence }], guardBaselines), /INVALID_GUARD_LABEL/);
  assert.throws(() => benchmarkGuards([{ request, evidence, expected_accept: true }], { wrong: { accept: () => 'yes' } }), /INVALID_GUARD_DECISION/);
});
