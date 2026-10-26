import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const map = JSON.parse(await readFile(new URL('dist/unified-worker/unified-worker.js.map', root), 'utf8'));
const code = await readFile(new URL('dist/unified-worker/unified-worker.js', root), 'utf8');
const allowed = ['src/errors.mjs','src/responses.mjs','src/decimal.mjs','src/upstream.mjs','src/miner.mjs','src/onchain/routes.mjs','src/onchain/input.mjs','src/onchain/rpc.mjs','src/onchain/verify.mjs','src/unified.mjs','src/weather.mjs','deploy/unified-worker.mjs'];
assert.equal(map.sources.length, allowed.length);
assert(map.sources.every(p => allowed.some(a => p.replaceAll('\\', '/').endsWith(a))), 'Non-runtime source in upload');
assert(!/local-competitor-audit|PREVIOUS_WINNER_AUDIT|ASYMMETRIC_STRATEGY|register-miner|update-miner|PRIVATE_KEY|gh[pousr]_[A-Za-z0-9]{20}/.test(code));
const assets = (await readdir(new URL('deploy/unified-public/', root))).sort();
assert.deepEqual(assets, ['artifact-manifest.json','miner.yaml','referenceforge-comparator.wasm','referenceforge-unified.yaml']);
const prepared = JSON.parse(await readFile(new URL('reports/unified/prepared.json', root), 'utf8'));
for (const row of [...prepared.old_assets_preserved, {file:'referenceforge-unified.yaml',sha256:prepared.yaml_sha256}]) {
  const bytes = await readFile(new URL('deploy/unified-public/' + row.file, root));
  assert.equal('0x' + createHash('sha256').update(bytes).digest('hex'), row.sha256);
}
const report = { checked_at: new Date().toISOString(), bundled_sources: map.sources, public_assets: assets, source_boundary_passed: true, signing_code_absent: true, yaml_sha256: prepared.yaml_sha256, bytes: Buffer.byteLength(code) };
await mkdir(new URL('reports/unified/', root), { recursive: true });
await writeFile(new URL('reports/unified/bundle-audit.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
