import test from 'node:test';
import assert from 'node:assert/strict';
import { minerDescriptor } from '../tools/render-miner.mjs';

test('descriptor uses current documented endpoint and parameter-location contracts', () => {
  const d = minerDescriptor({ id: 1900999000, baseUrl: 'http://127.0.0.1:8787' });
  assert.equal(d.semantics.signal_mapping.label_field, 'numeric_value');
  assert.equal(d.errors.message_path, 'error.message');
  assert.equal(d.auth.type, 'none');
  assert.deepEqual(d.endpoints[0].params.query.required.map(p=>p.name),['base','quote']);
  assert.deepEqual(d.endpoints[1].params.query.required.map(p=>p.name),['country','indicator']);
  for (const key of ['version', 'kind', 'id', 'slug', 'name', 'base_url']) assert.ok(Object.hasOwn(d, key));
  for (const endpoint of d.endpoints) {
    assert.equal(endpoint.external_path, endpoint.path);
    assert.ok(endpoint.intents.length > 0);
    assert.ok(endpoint.description.length > 40);
    assert.ok(endpoint.params.query);
    assert.equal(endpoint.params.type, undefined);
    for (const p of [...endpoint.params.query.required, ...endpoint.params.query.optional]) {
      assert.ok(p.name); assert.equal(p.type, 'string'); assert.deepEqual(p.intents, ['*']);
    }
    assert.equal(endpoint.input_schema, undefined);
  }
});

test('descriptor requires an explicit candidate identity and safe base origin', () => {
  for (const id of [0, -1, NaN, 2_147_483_648]) assert.throws(() => minerDescriptor({ id, baseUrl: 'https://example.com' }));
  for (const baseUrl of ['ftp://example.com', 'https://user:pass@example.com', 'https://example.com/path']) assert.throws(() => minerDescriptor({ id: 1, baseUrl }));
});
