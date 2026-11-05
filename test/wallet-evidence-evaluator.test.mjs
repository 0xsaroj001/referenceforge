// Original development fixtures, not real source captures or holdout material.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deriveWalletBalance, checkWalletBalanceEvidence, WALLET_ANSWER_FIELDS} from '../evaluator-v2/wallet-evidence.mjs';
const hash = digit => '0x' + digit.repeat(64), address = '0x' + 'a'.repeat(40);
const hex = number => '0x' + BigInt(number).toString(16);
function fixture(chain = 'base', wei = 1234560000000000000n) {
  const observed_at = '2026-11-02T10:00:10.000Z', block = {hash: hash('b'), number: '0x100', timestamp: hex(Date.parse('2026-11-02T10:00:00.000Z') / 1000)};
  return {request: {chain, address}, evidence: {observed_at, captures: ['https://first.example.test', 'https://second.example.test'].map(source => ({source, chain_id: chain === 'base' ? '0x2105' : '0x14a34', block: {...block}, query: {address, block_hash: block.hash, require_canonical: true}, balance_wei: hex(wei), captured_at: '2026-11-02T10:00:05.000Z'}))}};
}
const answer = fixture => deriveWalletBalance(fixture.request, fixture.evidence);
const run = (f, candidate = answer(f)) => checkWalletBalanceEvidence(f.request, f.evidence, candidate);

test('wallet evaluator field contract matches the pinned canonical response exactly', async () => {
  const contracts = JSON.parse(await readFile(new URL('../contracts/v2-intents.json', import.meta.url), 'utf8'));
  assert.deepEqual(WALLET_ANSWER_FIELDS, contracts.contracts.find(c => c.intent === 'WALLET_BALANCE_CHECK_GENERAL').response.fields.map(f => f.name));
});
test('supported native Base and Base Sepolia controls accept with explicit proof limits', () => {
  for (const chain of ['base', 'base_sepolia']) {
    const f = fixture(chain), result = run(f);
    assert.equal(result.outcome, 'accept'); assert(result.valid);
    assert.equal(answer(f).balance, 1.23456);
    for (const flag of ['cryptographic_state_proof', 'source_authenticity_verified', 'finality_verified']) assert.equal(result[flag], false);
  }
});
test('zero, exact micro-ETH and mixed-case identifiers preserve whole-unit semantics', () => {
  for (const wei of [0n, 1_000_000_000_000n, 10n ** 18n]) {
    const f = fixture('base', wei); f.request.address = address.toUpperCase().replace('0X', '0x');
    assert.equal(run(f).outcome, 'accept');
    assert.equal(answer(f).balance, Number(wei / 1_000_000_000_000n) / 1e6);
  }
});
test('wrong canonical balances, units, chain, address, retrieval time and unsupported extra claims reject', () => {
  const f = fixture(), good = answer(f);
  for (const mutation of [{balance: 1234560000000000000}, {balance: '1.23456'}, {balance: 1.234561}, {token_symbol: 'USDC'}, {chain: 'ethereum'}, {address: '0x' + 'c'.repeat(40)}, {as_of: '2026-11-02T10:00:00.000Z'}, {finalized: true}, {block_number: 256}]) assert.equal(run(f, {...good, ...mutation}).outcome, 'reject');
  const zero = fixture('base', 0n); assert.equal(run(zero, {...answer(zero), balance: -0}).outcome, 'reject');
});
test('insufficient and unsupported evidence abstains before candidate grading', () => {
  const mutations = [f => {f.request.chain = 'ethereum';}, f => {f.request.address = 'alice.eth';}, f => {f.request.token = 'USDC';}, f => {f.evidence.captures.pop();}, f => {f.evidence.captures[0].balance_wei = '0x01';}];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(run(f, {}).outcome, 'abstain'); }
});
test('disagreeing balances, chains, blocks and duplicate declared hosts abstain', () => {
  const mutations = [f => {f.evidence.captures[1].balance_wei = '0x0';}, f => {f.evidence.captures[1].chain_id = '0x14a34';}, f => {f.evidence.captures[1].block.number = '0x101';}, f => {f.evidence.captures[1].block.hash = hash('c'); f.evidence.captures[1].query.block_hash = hash('c');}, f => {f.evidence.captures[1].source = 'https://first.example.test/another-path';}];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(run(f, {}).outcome, 'abstain'); }
});
test('a quantity detached from address or canonical block query abstains', () => {
  for (const mutation of [{address: '0x' + 'c'.repeat(40)}, {block_hash: hash('c')}, {require_canonical: false}]) {
    const f = fixture(); Object.assign(f.evidence.captures[1].query, mutation); assert.equal(run(f, {}).refusal, 'UNBOUND_BALANCE_QUERY');
  }
});
test('future, stale and invalid timestamps abstain without asserting current wall-clock freshness', () => {
  const mutations = [f => {f.evidence.captures[0].captured_at = '2026-11-02T10:00:11.000Z';}, f => {f.evidence.captures[0].block.timestamp = hex(Date.parse('2026-11-02T09:00:00.000Z') / 1000);}, f => {f.evidence.observed_at = '2026-02-30T00:00:00.000Z';}, f => {f.evidence.captures[0].captured_at = '2026-11-02T09:58:00.000Z';}];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(run(f, {}).outcome, 'abstain'); }
});
test('sub-micro dust and unsafe numeric balances abstain instead of rounding evidence', () => {
  for (const wei of [1n, 1_000_000_000_001n, (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000_000n]) assert.equal(run(fixture('base', wei), {}).refusal, 'BALANCE_PRECISION_GAP');
});
test('duplicate JSON, getters, inherited fields and non-enumerable evidence never grade as valid', () => {
  const f = fixture(), good = answer(f), raw = JSON.stringify(good).replace('"balance":1.23456', '"balance":0,"balance":1.23456');
  assert.equal(run(f, raw).outcome, 'reject');
  assert.equal(checkWalletBalanceEvidence(f.request, '{"observed_at":null,"observed_at":null}', good).outcome, 'abstain');
  let reads = 0; const getter = {...good}; Object.defineProperty(getter, 'balance', {enumerable: true, get() { reads++; return good.balance; }});
  assert.equal(run(f, getter).outcome, 'reject'); assert.equal(reads, 0);
  const inherited = Object.create(good); assert.equal(run(f, inherited).outcome, 'reject');
  const evidence = fixture(); Object.defineProperty(evidence.evidence.captures[0], 'balance_wei', {enumerable: false, value: '0x0'}); assert.equal(run(evidence, good).outcome, 'abstain');
});
test('candidate corruption cannot alter source reference, and JSON strings use the same policy', () => {
  const f = fixture(), good = answer(f), before = JSON.stringify(f);
  assert.equal(checkWalletBalanceEvidence(JSON.stringify(f.request), JSON.stringify(f.evidence), JSON.stringify(good)).outcome, 'accept');
  assert.equal(run(f, {...good, balance: null}).outcome, 'reject'); assert.equal(JSON.stringify(f), before); assert.equal(run(f).outcome, 'accept');
});
