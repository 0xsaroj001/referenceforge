import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedHandler, UNIFIED_INTENTS, UNIFIED_PATHS } from '../src/unified.mjs';
import { createUnifiedWorker } from '../deploy/unified-worker.mjs';
import { unifiedDescriptor } from '../tools/render-unified-miner.mjs';
import { createMiner } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { fixture, NOW } from './fixtures/onchain.mjs';
import { cases } from './fixtures/onchain-cases.mjs';

const clock = () => new Date(NOW);
const xml = `<Envelope><Cube time='2026-10-23'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/></Cube></Envelope>`;
const post = (path, body) => new Request('https://test' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function numeric(value = '-1.234567890123456789') {
  return createMiner({ now: clock, sources: createSources({ now: clock, fetchImpl: async url => new Response(url.includes('ecb') ? xml : `[{"pages":1,"lastupdated":"2026-10-08"},[{"indicator":{"id":"FP.CPI.TOTL.ZG"},"country":{"id":"US"},"date":"2019","value":${value}}]]`) }) });
}
test('unified descriptor declares precisely four mapped endpoints and a common exact score field', () => {
  const d = unifiedDescriptor(); assert.equal(d.name, 'ReferenceForge'); assert.equal(d.slug, 'referenceforge-numeric'); assert.equal(d.id, 1900999000);
  assert.deepEqual(d.semantics.supported_intents, [...UNIFIED_INTENTS]); assert.equal(d.semantics.signal_mapping.label_field, 'score_value');
  assert.deepEqual(d.endpoints.map(e => e.path), [...UNIFIED_PATHS]);
  for (let i = 0; i < 4; i++) { assert.deepEqual(d.endpoints[i].intents, [UNIFIED_INTENTS[i]]); assert(d.endpoints[i].params.query.required.length > 0); }
  assert.equal(d.auth.type, 'none'); assert.equal(d.cache_ttl_sec, 0);
});
test('numeric mapping preserves exact decimals, source and observation context on GET and POST', async () => {
  const handle = createUnifiedHandler({ numeric: numeric() });
  const fx = await (await handle(new Request('https://test/fx?base=USD&quote=INR&amount=2.5'))).json();
  assert.equal(fx.score_value, '50.000000000000'); assert.equal(fx.score_value, fx.numeric_value); assert.equal(fx.converted_amount, '125.000000000000');
  assert.equal(fx.intent, 'FX_NOW'); assert.equal(fx.observation_date, '2026-10-23'); assert.match(fx.source.source_url, /ecb/); assert.match(fx.local_content_sha256, /^[a-f0-9]{64}$/);
  for (const value of ['-1.234567890123456789', '0', '9007199254740993123456789']) {
    const handler = createUnifiedHandler({ numeric: numeric(value) });
    const r = await handler(post('/macro', { country: 'US', indicator: 'inflation', year: '2019' })); assert.equal(r.status, 200);
    const macro = await r.json(); assert.equal(macro.score_value, value); assert.equal(macro.numeric_value, value); assert.equal(macro.observation_year, 2019);
  }
});
test('numeric refusals and unavailable sources have no fabricated mapped score', async () => {
  for (const request of [new Request('https://test/fx?question=spot+USD+to+INR'), post('/macro', { country: 'US', indicator: 'inflation', year: '2018' })]) {
    const r = await createUnifiedHandler({ numeric: numeric() })(request), answer = await r.json();
    assert(r.status >= 400); assert.equal(answer.verified_answer, false); assert.equal(Object.hasOwn(answer, 'score_value'), false);
  }
  const broken = createMiner({ sources: createSources({ maxAttempts: 1, fetchImpl: async () => { throw new Error('unavailable'); } }) });
  const r = await createUnifiedHandler({ numeric: broken })(new Request('https://test/fx?base=USD&quote=INR'));
  assert.equal(r.status, 503); assert.equal(Object.hasOwn(await r.json(), 'score_value'), false);
});
test('numeric source cache shares resolved text only and revalidates across request-owned clients', async () => {
  const cache = new Map(); let loads = 0;
  const options = { cache, fetchImpl: async () => { loads++; return new Response(xml); } };
  const first = createSources(options), second = createSources(options), url = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
  await first.get(url, 10000, { validate: text => assert.equal(text, xml) });
  assert.equal((await second.get(url, 10000, { validate: text => assert.equal(text, xml) })).cache_hit, true); assert.equal(loads, 1);
  let checked = false;
  await assert.rejects(second.get(url, 10000, { validate: () => { checked = true; throw new Error('invalid cached text'); } })); assert.equal(checked, true);
  assert([...cache.values()].every(entry => typeof entry.value.text === 'string' && !(entry.value instanceof Promise)));
  let release; const shared = new Map();
  const a = createSources({ cache: shared, fetchImpl: () => new Promise(r => { release = () => r(new Response(xml)); }) });
  let secondLoads = 0; const b = createSources({ cache: shared, fetchImpl: async () => { secondLoads++; return new Response(xml); } });
  const pending = a.get(url, 10000); await b.get(url, 10000); assert.equal(secondLoads, 1); release(); await pending;
});
for (const c of cases) test('unified HTTP preserves onchain requirement: ' + c.id, async () => {
  const f = fixture(c.options), handle = createUnifiedHandler({ onchain: createOnchainMiner({ fetchImpl: f.fetchImpl, now: () => NOW, rpcTimeoutMs: c.rpcTimeoutMs ?? 1000 }) });
  const r = await handle(post(c.method === 'transfer' ? '/verify-transfer' : '/onchain-metric', c.params)), answer = await r.json();
  if (c.error) { assert(r.status >= 400); assert.equal(answer.error.code, c.error); assert.equal(Object.hasOwn(answer, 'score_value'), false); }
  else { assert.equal(r.status, 200); c.check(answer, f); }
  if (c.no_io) assert.equal(f.calls.length, 0);
});
test('all endpoints reject duplicate/conflicting inputs, oversized bodies and unsupported methods', async () => {
  const handle = createUnifiedHandler();
  for (const path of UNIFIED_PATHS) {
    assert.equal((await handle(new Request('https://test' + path + '?chain=base&chain=base-sepolia'))).status, 400);
    assert.equal((await handle(post(path + '?chain=base', { chain: 'base-sepolia' }))).status, 400);
    assert.equal((await handle(post(path, []))).status, 400);
    assert.equal((await handle(new Request('https://test' + path, { method: 'DELETE' }))).status, 405);
    assert.equal((await handle(new Request('https://test' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) }))).status, 400);
  }
});
test('Worker assets are explicit and byte-preserving; handlers are request-owned', async () => {
  let factories = 0;
  const worker = createUnifiedWorker({ handlerFactory: () => { factories++; return createUnifiedHandler({ numeric: numeric() }); } });
  const asset = 'exact old bytes\n', env = { ASSETS: { fetch: async () => new Response(asset) } };
  for (const path of ['/miner.yaml', '/referenceforge-unified.yaml', '/referenceforge-comparator.wasm', '/artifact-manifest.json']) {
    const r = await worker.fetch(new Request('https://test' + path), env); assert.equal(await r.text(), asset);
  }
  assert.equal(factories, 0);
  for (const path of ['/health', '/health']) { const r = await worker.fetch(new Request('https://test' + path), env); assert.deepEqual((await r.json()).supported_intents, [...UNIFIED_INTENTS]); }
  assert.equal(factories, 2);
  for (const path of ['/reports/test.json', '/research/', '/.env', '/sign']) assert.equal((await worker.fetch(new Request('https://test' + path), env)).status, 404);
});
