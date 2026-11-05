import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUniqueJson } from '../evaluator-v2/strict-json.mjs';
import { validateJsonl } from '../evaluator-v2/pool.mjs';

// Public development checks for input ambiguity; no private evaluation examples.
const row = () => ({ prompt: 'Inspect this public parser fixture only.', chosen: 'accepted fixture answer',
  rejected: 'rejected fixture answer', provenance: { source_kind: 'synthetic', source_url: 'https://example.org/unit' } });
const errors = raw => validateJsonl(raw + '\n').errors.map(error => error.message);

test('pool ambiguity gate refuses overwritten preferred answers and provenance', () => {
  const raw = JSON.stringify(row()).slice(0, -1);
  for (const extra of [',"chosen":"different hidden preference"}', ',"provenance":{"source_url":"https://example.org/attestation"}}']) {
    const result = validateJsonl(raw + extra + '\n');
    assert.equal(result.valid, false);
    assert(result.errors.some(error => error.message === 'DUPLICATE_JSON_KEY'));
    assert.equal(result.rows.length, 0);
    assert.deepEqual(result.provenance, {});
  }
});

test('escaped property aliases cannot hide a duplicate prompt or nested synthetic label', () => {
  const raw = JSON.stringify(row()).slice(0, -1);
  assert(errors(raw + ',"pr\\u006fmpt":"A concealed replacement question"}').includes('DUPLICATE_JSON_KEY'));
  assert(errors(JSON.stringify(row()).replace('"source_kind":"synthetic"', '"source_kind":"synthetic","source_ki\\u006ed":"human"')).includes('DUPLICATE_JSON_KEY'));
});

test('each object has its own key scope, including objects nested in arrays', () => {
  const raw = '{"first":{"id":1},"second":{"id":2},"items":[{"id":3},{"id":4}]}';
  assert.deepEqual(parseUniqueJson(raw), JSON.parse(raw));
  assert.throws(() => parseUniqueJson('{"items":[{"id":3,"id":4}]}'), { code: 'DUPLICATE_JSON_KEY' });
});

test('JSON-looking text and escaped quotes inside strings are not object keys', () => {
  const data = { prompt: 'Text says "provenance": { "id": 1, "id": 2 } and has \\ backslashes.', items: ['":"', '"id":3'] };
  assert.deepEqual(parseUniqueJson(JSON.stringify(data)), data);
  assert.equal(validateJsonl(JSON.stringify(row()) + '\n').valid, true);
});

test('malformed JSON remains a syntax error and duplicate keys disclose no row content', () => {
  assert(errors('{"prompt":').includes('INVALID_JSON'));
  assert.throws(() => parseUniqueJson('{"private-example":1,"private-example":2}'), error => {
    assert.equal(error.message, 'DUPLICATE_JSON_KEY');
    assert(!error.message.includes('private-example'));
    return true;
  });
});
