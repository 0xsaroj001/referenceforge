import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const bytes = await readFile(resolve(root, 'dist/referenceforge-comparator.wasm'));
const samples = [], compiledSamples = [], instances = [];
for (let i = 0; i < 20; i++) { const t = performance.now(); const m = await WebAssembly.compile(bytes); compiledSamples.push(performance.now() - t); const s = performance.now(); const w = await WebAssembly.instantiate(m); instances.push(performance.now() - s); }
const m = await WebAssembly.compile(bytes), w = (await WebAssembly.instantiate(m)).exports;
const p = w.imw_alloc(16), spec = new DataView(w.memory.buffer); spec.setBigInt64(p, 2n, true); spec.setBigInt64(p + 8, 50n, true);
let checksum = 0n;const inputs = Array.from({ length: 100 }, (_, i) => 1_000_000n + BigInt(i * 137));
// Warm up separately; each reported call includes the JS -> WASM boundary.
for (let i = 0; i < 20_000; i++) checksum += w.imw_score_deterministic(1_000_000n, inputs[i % 100], p);
for (let batch = 0; batch < 25; batch++) { const started = performance.now(); for (let i = 0; i < 20_000; i++) checksum += w.imw_score_deterministic(1_000_000n, inputs[i % 100], p); samples.push((performance.now() - started) * 1000 / 20_000); }
const stats = values => { const sorted = [...values].sort((a, b) => a - b);return { min: sorted[0], p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }; };
const report = { checked_at: new Date().toISOString(), artifact_sha256: createHash('sha256').update(bytes).digest('hex'), artifact_bytes: bytes.length, initial_memory_bytes: w.memory.buffer.byteLength, node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, compile_ms: stats(compiledSamples), instantiate_ms: stats(instances), score_microseconds_per_call: stats(samples), calls: 500_000, warmup_calls: 20_000, checksum: checksum.toString(), method: '25 batches of 20,000 warmed calls, 100 different miner values, arithmetic plus JS/WASM crossing; compile may use V8 cache. Not a cross-machine or competitor comparison.', status: 'local_performance_only' };
await writeFile(resolve(root, 'reports/wasm-benchmark.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
