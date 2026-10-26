import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expandedDescriptor, UNIFIED_ORIGIN } from './render-expanded-miner.mjs';
const sha = b => '0x' + createHash('sha256').update(b).digest('hex');
const root = new URL('../', import.meta.url), dir = new URL('deploy/expanded-public/', root), reportDir = new URL('reports/intent-expansion/', root);
const oldFiles = ['miner.yaml','referenceforge-comparator.wasm','artifact-manifest.json','referenceforge-unified.yaml'];
const candidates = ['referenceforge-expanded.yaml','referenceforge-expanded-no-fx.yaml'];
await mkdir(dir, { recursive: true }); await mkdir(reportDir, { recursive: true });
assert((await readdir(dir)).every(x => [...oldFiles,...candidates].includes(x)));
const preserved = [];
for (const file of oldFiles) {
  const r = await fetch(UNIFIED_ORIGIN + '/' + file, { redirect: 'error', signal: AbortSignal.timeout(15000) }); assert(r.ok);
  const bytes = Buffer.from(await r.arrayBuffer()); assert(bytes.length < 100000);
  if (file === 'referenceforge-unified.yaml') assert.equal(sha(bytes), '0x6c1d031c2cc64ad6a57db83c8bb18af5538ef9531df2872b11267ead929d349a');
  await writeFile(new URL(file, dir), bytes); preserved.push({ file, sha256: sha(bytes) });
}
const outputs = [];
for (const keepFx of [true, false]) {
  const file = candidates[keepFx ? 0 : 1], descriptor = expandedDescriptor({ keepFx }), bytes = JSON.stringify(descriptor, null, 2) + '\n';
  await writeFile(new URL(file, dir), bytes); outputs.push({ keepFx, file, url: UNIFIED_ORIGIN + '/' + file, hash: sha(bytes), bytes: Buffer.byteLength(bytes), intents: descriptor.semantics.supported_intents });
}
const report = { prepared_at: new Date().toISOString(), target_registration: 4844, preserved, outputs, onchain_update_sent: false };
await writeFile(new URL('prepared.json', reportDir), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
