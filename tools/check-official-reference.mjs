// The reviewed MIT-licensed V2 reference is used only in this local benchmark.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'research/official-v2-kit/reference-runner');
await mkdir(directory, { recursive: true });
const revision = '992f2650cf99e3d35306a782cf5f39967a121796';
// Only the fixed, reviewed official MIT reference is downloaded and executed.
// Source and license stay in an ignored local cache; neither is product code.
async function pinnedFile(path, expectedHash) {
  const file = resolve(root, 'research/official-v2-kit', path);
  let bytes;
  try { bytes = await readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://raw.githubusercontent.com/telegraphprotocol/telegraph-wasm-baseline/${revision}/${path}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`Official reference fetch failed: ${response.status}`);
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 100000) throw new Error('Official reference exceeds size bound'); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel(); }
    bytes = Buffer.concat(chunks);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error(`Pinned official reference changed: ${path}`);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, bytes);
  return bytes.toString('utf8');
}
await pinnedFile('LICENSE', 'e20635bc37e1ec73cc962c20cf23b0043bfcf20d01dbcefb959238ebc2f8fde1');
const original = await pinnedFile('pkg/scoring/comparator/reference.go', '26e9e139e690398ee751361a5bfde7c48f6d4465f83f8f6a488c2743511af017');
await writeFile(resolve(directory, 'reference.go'), original.replace(/^package comparator/m, 'package main'));
await writeFile(resolve(directory, 'main.go'), `package main
import ("encoding/json"; "os"; "strconv")
const(CmpExact int64=0; CmpAbsTol int64=1; CmpRelTol int64=2; CmpPassFail int64=3)
type V struct {Truth string; Miner string; Code string; Tolerance string}
func n(s string) int64 {v,e:=strconv.ParseInt(s,10,64);if e!=nil {panic(e)};return v}
func main(){var rows []V;if e:=json.NewDecoder(os.Stdin).Decode(&rows);e!=nil{panic(e)};out:=make([]string,len(rows));for i,v:=range rows {out[i]=strconv.FormatInt(ReferenceScore(n(v.Code),n(v.Tolerance),n(v.Truth),n(v.Miner)),10)};if e:=json.NewEncoder(os.Stdout).Encode(out);e!=nil{panic(e)}}
`);
const vectors = JSON.parse(await readFile(resolve(root, 'reports/comparator-vectors.json'), 'utf8'));
// Source-pinned answer key is executed unchanged apart from its package name.
const run = spawnSync('go', ['run', 'main.go', 'reference.go'], { cwd: directory, input: JSON.stringify(vectors), encoding: 'utf8', timeout: 60_000, maxBuffer: 8_000_000 });
if (run.error || run.status) throw new Error(run.error?.message ?? run.stderr);
const official = JSON.parse(run.stdout);
const max = 2n ** 63n - 1n, min = -(2n ** 63n);
const domain = v => {
  const t = BigInt(v.truth), m = BigInt(v.miner), c = BigInt.asIntN(32, BigInt(v.code)), tol = BigInt(v.tolerance), diff = m - t;
  if (t === 0n) return false;
  if (![1n, 2n].includes(c)) return true;
  if (diff < -max || diff > max) return false;
  return !(c === 2n && t === min);
};
async function measure(file, optional = false) {
  let bytes;
  try { bytes = await readFile(resolve(root, file)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  const { instance: { exports: wasm } } = await WebAssembly.instantiate(bytes);
  const pointer = wasm.imw_alloc(16), view = new DataView(wasm.memory.buffer);
  const differences = [], outside = []; let equal = 0, inDomain = 0;
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]; view.setBigInt64(pointer, BigInt(v.code), true); view.setBigInt64(pointer + 8, BigInt(v.tolerance), true);
    const actual = wasm.imw_score_deterministic(BigInt(v.truth), BigInt(v.miner), pointer).toString();
    if (!domain(v)) { outside.push({ ...v, actual, official: official[i], note: 'Reference release-mode overflow domain; production refuses instead of wrapping.' }); continue; }
    inDomain++; if (actual === official[i]) equal++; else differences.push({ ...v, actual, official: official[i] });
  }
  return { artifact_sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, in_domain_vectors: inDomain, exact_matches: equal, mismatches: differences.length, mismatch_examples: differences.slice(0, 8), outside_safe_domain: outside.length, outside_safe_domain_examples: outside.slice(0, 4) };
}
const report = { checked_at: new Date().toISOString(), source: { repo: 'telegraphprotocol/telegraph-wasm-baseline', ref: '992f2650cf99e3d35306a782cf5f39967a121796', path: 'pkg/scoring/comparator/reference.go', source_sha256: createHash('sha256').update(original).digest('hex'), state: 'official open PR #2, not proof of deployed node version', modification: 'package name only for standalone Go execution', license: 'MIT, preserved in research/official-v2-kit/LICENSE' },
  baseline_v01: await measure('research/build-baseline/referenceforge-comparator-v0.1.wasm', true), current: await measure('dist/referenceforge-comparator.wasm'), status: 'local_against_pinned_official_source_not_network_admission' };
await writeFile(resolve(root, 'reports/official-reference-compatibility.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.current.mismatches) process.exitCode = 1;
