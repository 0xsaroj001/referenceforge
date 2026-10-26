import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unifiedDescriptor, UNIFIED_ORIGIN } from './render-unified-miner.mjs';
const origin = process.argv[2] ?? 'http://127.0.0.1:8792';
assert(['http://127.0.0.1:8792', UNIFIED_ORIGIN].includes(origin), 'Unexpected smoke target');
const root = new URL('../', import.meta.url), rows = [], dir = new URL('reports/unified/', root);
const prepared = JSON.parse(await readFile(new URL('prepared.json', dir), 'utf8'));
const sha = b => '0x' + createHash('sha256').update(b).digest('hex');
async function check(id, path, status, verify, options = {}) {
  const start = performance.now();
  try {
    const r = await fetch(origin + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const bytes = Buffer.from(await r.arrayBuffer()); assert(bytes.length < 2097152); assert.equal(r.status, status);
    let body; try { body = JSON.parse(bytes.toString('utf8')); } catch {}
    await verify?.(body, r, bytes); rows.push({ id, pass: true, status: r.status, latency_ms: performance.now() - start, ...(body?.duration_ms === undefined ? {} : { worker_duration_ms: body.duration_ms }) });
  } catch (e) { rows.push({ id, pass: false, error: e.message.slice(0, 400), latency_ms: performance.now() - start }); }
}
await check('combined-yaml', '/referenceforge-unified.yaml', 200, (body, r, bytes) => {
  assert.equal(sha(bytes), prepared.yaml_sha256); assert.deepEqual(body, unifiedDescriptor()); assert.match(r.headers.get('content-type'), /yaml/);
});
for (const asset of prepared.old_assets_preserved) await check('preserved-' + asset.file, '/' + asset.file, 200, (_, __, bytes) => assert.equal(sha(bytes), asset.sha256));
await check('four-intent-health', '/health', 200, body => assert.deepEqual(body.supported_intents, unifiedDescriptor().semantics.supported_intents));
for (const path of ['/research/', '/reports/verification.json', '/.env', '/sign']) await check('private-absent-' + path, path, 404);
for (const path of ['/fx', '/macro', '/verify-transfer', '/onchain-metric']) {
  await check('required-input-' + path, path, 422, body => { assert.equal(body.verified_answer, false); assert(!Object.hasOwn(body, 'score_value')); });
  await check('duplicate-input-' + path, path + '?chain=base&chain=base-sepolia', 400);
}
await check('conflicting-post', '/fx?base=USD', 400, null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"base":"EUR"}' });
await check('unsupported-spot', '/fx?question=spot+USD+to+INR', 422, body => assert(!Object.hasOwn(body, 'score_value')));
await check('real-FX', '/fx?base=USD&quote=INR&amount=2.5', 200, body => {
  assert.equal(body.score_value, body.numeric_value); assert.equal(typeof body.score_value, 'string'); assert.equal(body.intent, 'FX_NOW'); assert.equal(body.frequency, 'daily_reference'); assert.match(body.source.source_url, /ecb/);
});
await check('real-macro-POST', '/macro', 200, body => {
  assert.equal(body.score_value, body.numeric_value); assert.equal(body.intent, 'MACRO_ECONOMIC_INDICATOR'); assert.equal(body.observation_year, 2019); assert.match(body.source.source_url, /worldbank/);
}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"country":"US","indicator":"unemployment","year":"2019"}' });
const live = JSON.parse(await readFile(new URL('reports/onchain-miner/live-benchmark.json', root), 'utf8'));
for (const chain of ['base', 'base-sepolia']) for (const kind of ['transfer', 'metric']) {
  const example = live.rows.find(x => x.kind === kind && x.params.chain === chain && x.http_status === 200 && (kind === 'transfer' ? x.answer.claim_verified : x.params.metric === 'gas'));
  assert(example, 'Missing captured live example');
  await new Promise(r => setTimeout(r, 1200));
  await check('real-' + chain + '-' + kind, (kind === 'transfer' ? '/verify-transfer' : '/onchain-metric') + '?' + new URLSearchParams(example.params), 200, body => {
    assert.equal(body.score_value, example.answer.score_value); assert.equal(body.verified_answer, true); assert.equal(body.verification.sources.length, 2);
  });
}
const example = live.rows.find(x => x.kind === 'transfer' && x.params.asset === 'erc20' && x.http_status === 200 && x.answer.claim_verified);
await new Promise(r => setTimeout(r, 1200));
await check('real-ERC20-POST', '/verify-transfer', 200, body => { assert.equal(body.claim_verified, true); assert.equal(body.score_value, example.answer.score_value); }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(example.params) });
const report = { checked_at: new Date().toISOString(), origin, checks: rows.length, passed: rows.filter(x => x.pass).length, rows, yaml_url: UNIFIED_ORIGIN + '/referenceforge-unified.yaml', yaml_sha256: prepared.yaml_sha256,
  scope: 'HTTP transport, exact-byte preservation and all four endpoints using real public sources. No Telegraph routed request, scoring, wallet transaction or paid call.' };
await mkdir(dir, { recursive: true });
const file = (origin === UNIFIED_ORIGIN ? 'public' : 'workerd') + '-smoke-' + Date.now() + '.json';
await writeFile(new URL(file, dir), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.passed !== report.checks) process.exitCode = 1;
