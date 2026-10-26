import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { unifiedDescriptor, UNIFIED_ORIGIN } from './render-unified-miner.mjs';
const root = new URL('../', import.meta.url), directory = new URL('deploy/unified-public/', root);
const names = ['artifact-manifest.json', 'miner.yaml', 'referenceforge-comparator.wasm', 'referenceforge-unified.yaml'];
const sha = b => '0x' + createHash('sha256').update(b).digest('hex');
await mkdir(directory, { recursive: true });
assert((await readdir(directory)).every(x => names.includes(x)), 'Unexpected asset in unified upload');
const before = [];
for (const file of names.filter(x => x !== 'referenceforge-unified.yaml')) {
  const r = await fetch(UNIFIED_ORIGIN + '/' + file, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert(r.ok, 'Existing public asset unavailable: ' + file);
  const bytes = Buffer.from(await r.arrayBuffer()); assert(bytes.length < 100000, 'Unexpected asset size');
  if (file === 'miner.yaml') assert.equal(sha(bytes), '0x5a676c4d038e763647772510967de4b381b9e149ac1d93423ad68e8669b12752');
  await writeFile(new URL(file, directory), bytes); before.push({ file, sha256: sha(bytes), bytes: bytes.length });
}
const text = JSON.stringify(unifiedDescriptor(), null, 2) + '\n';
await writeFile(new URL('referenceforge-unified.yaml', directory), text);
const result = { prepared_at: new Date().toISOString(), origin: UNIFIED_ORIGIN, yaml_url: UNIFIED_ORIGIN + '/referenceforge-unified.yaml', yaml_sha256: sha(text), bytes: Buffer.byteLength(text), old_assets_preserved: before,
  intents: unifiedDescriptor().semantics.supported_intents, update_registration: 4838, retire_only_after_activation: 4843, registration_sent: false };
await mkdir(new URL('reports/unified/', root), { recursive: true });
await writeFile(new URL('reports/unified/prepared.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
