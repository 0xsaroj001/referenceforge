import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiner, parseFxInput, parseMacroInput, parseEcb } from '../src/miner.mjs';
import { decimal, canonicalDecimal, parseJsonDecimals } from '../src/decimal.mjs';
import { createSources } from '../src/upstream.mjs';
import { createServer } from '../src/server.mjs';

const clock = () => new Date('2026-10-23T18:00:00Z');
const xml = `<Envelope><Cube><Cube time='2026-10-23'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/><Cube currency='JPY' rate='150'/></Cube></Cube></Envelope>`;
const row = (year, value, id = 'NY.GDP.MKTP.CD') => `{"indicator":{"id":"${id}"},"country":{"id":"IN","value":"India"},"countryiso3code":"IND","date":"${year}","value":${value}}`;
const macroData = (...rows) => `[{"pages":1,"lastupdated":"2026-10-08"},[${rows.join(',')}]]`;
function setup(body = xml) {
  let calls = 0;
  const sources = createSources({ now: clock, fetchImpl: async () => { calls++; return new Response(body); } });
  return { miner: createMiner({ sources, now: clock }), sources, calls: () => calls };
}

test('FX conversion uses correct cross-rate orientation and decimal arithmetic', async () => {
  const { miner } = setup();
  const a = await miner.fx({ base: 'USD', quote: 'INR', amount: '2.5' });
  assert.equal(a.rate, '50.000000000000'); assert.equal(a.converted_amount, '125.000000000000');
  assert.equal(a.observation_date, '2026-10-23'); assert.match(a.summary, /not an executable/);
  const b = await miner.fx({ base: 'INR', quote: 'USD' }); assert.equal(b.rate, '0.020000000000');
  assert.equal((await miner.fx({ base: 'USD', quote: 'USD' })).rate, '1.000000000000');
  assert.equal(a.source.cache_hit, false); assert.equal(b.source.cache_hit, true);
});

test('whole question aliases, per orientation and structured input precedence', () => {
  assert.deepEqual(parseFxInput({ question: 'convert 20 USD to INR' }), { base: 'USD', quote: 'INR', amount: '20' });
  assert.deepEqual(parseFxInput({ q: 'USD per EUR please' }), { base: 'EUR', quote: 'USD', amount: '1' });
  assert.equal(parseFxInput({ question: 'USD to INR', base: 'EUR' }).base, 'EUR');
  assert.throws(() => parseFxInput({ q: 'Convert -5 USD to INR' }), { code: 'INVALID_AMOUNT' });
  assert.throws(() => parseFxInput({ q: 'USD to INR and EUR to GBP' }), { code: 'AMBIGUOUS_PAIR' });
  assert.equal(parseFxInput({ q: 'USD to INR and EUR to GBP', base: 'USD', quote: 'INR', amount: 0 }).amount, '0');
});

test('unsupported and ambiguous questions cannot silently become an answer', async () => {
  const { miner, calls } = setup();
  for (const params of [{ q: 'spot USD/INR' }, { base: 'USD' }, { q: 'USD to INR on 2020-01-01' }]) await assert.rejects(miner.fx(params));
  assert.equal(calls(), 0);
  await assert.rejects(miner.fx({ base: 'RUB', quote: 'USD' }), { code: 'UNSUPPORTED_CURRENCY' });
});

test('stale, future, invalid, duplicate and empty FX feeds fail visibly', async () => {
  for (const date of ['2020-01-01', '2026-10-24']) {
    const { miner } = setup(xml.replace('2026-10-23', date));
    await assert.rejects(miner.fx({ base: 'USD', quote: 'INR' }), { code: 'STALE_SOURCE' });
  }
  assert.throws(() => parseEcb(xml.replace('2026-10-23', '2026-02-31')), { code: 'BAD_SOURCE_DATE' });
  assert.throws(() => parseEcb(xml.replace("currency='INR'", "currency='USD'")), { code: 'BAD_SOURCE' });
  assert.throws(() => parseEcb('<!DOCTYPE external><Cube/>'), { code: 'BAD_SOURCE' });
});

test('macro exact year is honored and long decimal tokens retain their precision', async () => {
  const { miner } = setup(macroData(row('2025', 'null'), row('2024', '1234567890123456.7890123')));
  const answer = await miner.macro({ country: 'IN', indicator: 'gdp', year: '2024' });
  assert.equal(answer.value, '1234567890123456.7890123');
  assert.equal(answer.observation_year, 2024); assert.equal(answer.frequency, 'annual');
  await assert.rejects(miner.macro({ country: 'IN', indicator: 'gdp', year: '2025' }), { code: 'OBSERVATION_UNAVAILABLE' });
  assert.equal((await miner.macro({ country: 'IN', indicator: 'gdp' })).observation_year, 2024);
});

test('macro negative percentages and zero observations are preserved', async () => {
  const { miner } = setup(macroData(row('2024', '-1.25e-2', 'NY.GDP.MKTP.KD.ZG'), row('2023', '0', 'NY.GDP.MKTP.KD.ZG')));
  const growth = await miner.macro({ country: 'IN', indicator: 'gdp_growth', year: '2024' });
  assert.equal(growth.value, '-0.0125'); assert.equal(growth.unit, 'annual percent');
  assert.equal((await miner.macro({ country: 'IN', indicator: 'gdp_growth', year: '2023' })).value, '0');
});

test('macro parser refuses mixed years, countries, unsupported frequency and indicators', () => {
  assert.deepEqual(parseMacroInput({ q: 'India GDP growth 2024' }, clock()), { country: 'IN', indicator: 'gdp_growth', year: '2024' });
  for (const q of ['India GDP 2023 and 2024', 'India and Japan GDP', 'India monthly CPI', 'India forecast GDP']) assert.throws(() => parseMacroInput({ q }, clock()));
  assert.throws(() => parseMacroInput({ country: '../../x', indicator: 'gdp' }, clock()));
  assert.throws(() => parseMacroInput({ country: 'IN', indicator: '__proto__' }, clock()));
});

test('source client deduplicates concurrent requests and will not follow arbitrary hosts', async () => {
  const { miner, sources, calls } = setup();
  await Promise.all(Array.from({ length: 10 }, () => miner.fx({ base: 'USD', quote: 'INR' })));
  assert.equal(calls(), 1);
  await assert.rejects(sources.get('https://www.ecb.europa.eu.evil.example/x', 0), { code: 'SOURCE_NOT_ALLOWED' });
  await assert.rejects(sources.get('http://www.ecb.europa.eu/x', 0), { code: 'SOURCE_NOT_ALLOWED' });
});

test('source failure never produces a fabricated successful observation', async () => {
  const sources = createSources({ fetchImpl: async () => new Response('no', { status: 500 }) });
  await assert.rejects(createMiner({ sources, now: clock }).fx({ base: 'EUR', quote: 'USD' }), { code: 'SOURCE_HTTP_ERROR' });
});

test('decimal parser rejects non-finite, extreme-scale and malformed values', () => {
  assert.deepEqual(decimal('1.25e-2'), { n: 125n, d: 10000n });
  assert.equal(canonicalDecimal('-0.000'), '0');
  assert.equal(parseJsonDecimals('{"x":9007199254740993}').x, '9007199254740993');
  for (const x of ['Infinity', 'NaN', '1e10000', '0x10']) assert.throws(() => decimal(x));
});

test('HTTP judge journey returns success, honest errors and unregistered health', async t => {
  const { miner } = setup(); const server = createServer({ miner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/health`)).json()).registration_status, 'not_registered');
  const response = await fetch(`${base}/fx?base=USD&quote=INR`); assert.equal(response.status, 200);
  const answer = await response.json(); assert.equal(answer.rate, '50.000000000000'); assert.match(answer.local_content_sha256, /^[a-f0-9]{64}$/);
  const bad = await fetch(`${base}/fx?base=USD`); assert.equal(bad.status, 422); assert.equal((await bad.json()).verified_answer, false);
  const invalid = await fetch(`${base}/fx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' }); assert.equal(invalid.status, 400);
  const wrongType = await fetch(`${base}/fx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: {} }) }); assert.equal(wrongType.status, 400);
  const unsupported = await fetch(`${base}/fx`, { method: 'PUT' }); assert.equal(unsupported.status, 405);
});
