import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectWasm } from './wasm-inspect.mjs';

const bytes = await readFile(new URL('../dist/referenceforge-comparator.wasm', import.meta.url));
const inspection = inspectWasm(bytes);
assert.equal(inspection.imports.length, 0);
assert.equal(inspection.comparator, true);
assert.equal(inspection.legacyRankAnswer, false);
const module = await WebAssembly.compile(bytes);
assert.deepEqual(WebAssembly.Module.imports(module), []);
const { exports: wasm } = await WebAssembly.instantiate(module);
const p = wasm.imw_alloc(16);
assert.ok(p > 0);
assert.equal(wasm.imw_alloc(17), 0);
assert.equal(wasm.imw_score_deterministic(1n, 1n, 0), -1n);
const spec = new DataView(wasm.memory.buffer);
const vectors = [];
const truths = [-1_000_000_000_000_000_000n, -1_000_000n, -1n, 1n, 100n, 1_000_000n, 1_000_000_000_000_000_000n];
const tolerances = [-1n, 0n, 1n, 10n, 100n, 10000n];
const deltas = [-20001n, -200n, -100n, -10n, -1n, 0n, 1n, 10n, 100n, 200n, 20001n];
for (const truth of truths) for (const code of [0n, 1n, 2n, 3n, 99n]) for (const tolerance of tolerances) for (const delta of deltas) vectors.push({ truth, miner: truth + delta, code, tolerance });
// Include full signed extremes and codes whose high 32 bits must be ignored.
const min = -(2n ** 63n), max = 2n ** 63n - 1n;
for (const truth of [min, max]) for (const miner of [min, 0n, max]) for (const code of [0n, 1n, 2n, 3n, (1n << 32n) + 1n]) for (const tolerance of [0n, 100n, max]) vectors.push({ truth, miner, code, tolerance });

// Independent host oracle written as a weighted distance in an unbounded
// integer domain. This tests the compiled ABI, signed words and arithmetic.
const abs = x => x < 0n ? -x : x;
function expected({ truth, miner, code, tolerance }) {
  code = BigInt.asIntN(32, code);
  if (truth === 0n) return -1n;
  if (![1n, 2n].includes(code)) return truth === miner ? 10000n : 0n;
  const diff = miner - truth;
  if (diff < -max || diff > max) return -1n;
  if (code === 2n && truth === min) return -1n;
  const clamp = n => n > max ? max : n;
  const distance = code === 1n ? abs(diff) : clamp(abs(diff) * 10000n / abs(truth));
  if (tolerance <= 0n) return distance === 0n ? 10000n : 0n;
  const window = clamp(tolerance * 2n);
  if (distance >= window) return 0n;
  return clamp(10000n * (window - distance)) / window;
}
function evaluate(v) {
  spec.setBigInt64(p, v.code, true); spec.setBigInt64(p + 8, v.tolerance, true);
  return wasm.imw_score_deterministic(v.truth, v.miner, p);
}
const started = performance.now();
const first = vectors.map(v => { const got = evaluate(v); assert.equal(got, expected(v), JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x)); return got; });
for (let n = vectors.length - 1; n >= 0; n--) assert.equal(evaluate(vectors[n]), first[n], 'Order-dependent result');
wasm.imw_free(p, 16);
for (const v of vectors.slice(0, 20)) { assert.equal(wasm.imw_alloc(16), p); assert.equal(evaluate(v), expected(v)); wasm.imw_free(p, 16); }
const report = { artifact_sha256: createHash('sha256').update(bytes).digest('hex'), vectors: vectors.length, exact_matches: vectors.length, max_deviation_bps: 0, deterministic_second_pass: true, imports: 0, runtime: `Node ${process.version} WebAssembly`, duration_ms: performance.now() - started, status: 'local_conformance_only_not_protocol_admission', comparator_rule_source: 'https://docs.telegraphprotocol.com/docs/scoring/build-a-scoring-module' };
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/comparator-vectors.json', import.meta.url), JSON.stringify(vectors.map(v => ({ ...v, expected: expected(v) })), (_key, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
await writeFile(new URL('../reports/wasm-conformance.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
