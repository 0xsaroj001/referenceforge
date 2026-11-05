import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2Handler, V2_INTENTS, V2_PATHS } from '../src/v2.mjs';
import { createMiner } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { createWeather } from '../src/weather.mjs';
import { fixture, A, TX, TOKEN, HEX, NOW } from './fixtures/onchain.mjs';

const request = (path, p = {}, method = 'GET') => new Request('https://provider.test' + path + (method === 'GET' ? '?' + new URLSearchParams(p) : ''), method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
async function invoke(handler, path, p, method) { const response = await handler(request(path, p, method)); return { response, body: await response.json() }; }
function macro(value = '4.25') {
  const now = () => new Date(NOW), calls = [];
  const sources = createSources({ now, maxAttempts: 1, fetchImpl: async url => {
    calls.push(url);
    return new Response(`[ {"pages":1,"lastupdated":"2026-10-08"},[{"indicator":{"id":"SL.UEM.TOTL.ZS"},"country":{"id":"IN","value":"India"},"countryiso3code":"IND","date":"2024","value":${value}}]]`);
  } });
  return { calls, numeric: createMiner({ sources, now }) };
}
function chain(options = {}) {
  const f = fixture(options);
  return { ...f, onchain: createOnchainMiner({ fetchImpl: f.fetchImpl, now: () => NOW }) };
}
function weather(mutate = () => {}) {
  const calls = [], origin = 'https://api.weather.gov', clock = Date.parse('2026-11-01T05:30:00Z');
  const fetchImpl = async url => {
    calls.push(url); const path = new URL(url).pathname;
    const body = path.startsWith('/points/') ? { type: 'Feature', properties: { timeZone: 'America/New_York', forecastHourly: origin + '/gridpoints/MFL/1,1/forecast/hourly', observationStations: origin + '/gridpoints/MFL/1,1/stations' } }
      : path.endsWith('/forecast/hourly') ? { properties: { updateTime: '2026-11-01T05:00:00Z', generatedAt: '2026-11-01T05:15:00Z', periods: Array.from({ length: 48 }, (_, i) => ({ startTime: new Date(clock + 1800000 + i * 3600000).toISOString(), endTime: new Date(clock + 5400000 + i * 3600000).toISOString(), temperature: 20 + i % 3, temperatureUnit: 'C', windSpeed: 'Calm', shortForecast: i % 2 ? 'Rain' : 'Cloudy', probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: i % 4 * 20 } })) } }
      : path.endsWith('/stations') ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-80.1918, 25.7617] }, properties: { stationIdentifier: 'KMIA', name: 'Miami' } }] }
      : { type: 'Feature', properties: { station: origin + '/stations/KMIA', timestamp: '2026-11-01T05:00:00Z', temperature: { value: 21.125, unitCode: 'wmoUnit:degC', qualityControl: 'V' }, windSpeed: { value: 0, unitCode: 'wmoUnit:km_h-1' }, relativeHumidity: { value: 60, unitCode: 'wmoUnit:percent' }, textDescription: 'Cloudy' } };
    mutate(body, path); return Response.json(body);
  };
  return { calls, weatherMiner: createWeather({ fetchImpl, now: () => new Date(clock) }) };
}

test('five concrete intent routes are distinct and no old family is simply relabeled', () => {
  assert.equal(V2_INTENTS.length, 5); assert.equal(V2_PATHS.length, 5);
  assert.equal(new Set(V2_INTENTS).size, 5); assert.equal(new Set(V2_PATHS).size, 5);
  assert(!V2_INTENTS.includes('FX_NOW')); assert(!V2_INTENTS.some(i => i.includes('STORM')));
});
test('annual unemployment output derives from the real source parser and retains exact evidence', async () => {
  const f = macro(), h = createV2Handler({ numeric: f.numeric });
  for (const method of ['GET', 'POST']) {
    const { response, body } = await invoke(h, '/v2/macro', { indicator: 'unemployment rate', country: 'IN', year: 2024 }, method);
    assert.equal(response.status, 200); assert.equal(body.rate_pct, 4.25); assert.equal(body.request_schema_version, 1); assert.equal(body.response_format_version, 1);
    assert.equal(body.evidence.value, '4.25'); assert.equal(body.evidence.indicator_id, 'SL.UEM.TOTL.ZS'); assert.match(body.evidence.source.source_url, /api.worldbank.org/);
    assert.match(body.evidence.source.payload_sha256, /^[a-f0-9]{64}$/); assert(!Object.hasOwn(body, 'field_status'));
  }
  assert.equal(f.calls.length, 1);
});
test('canonical numeric encoding refuses loss of source decimal precision rather than rounding', async () => {
  const f = macro('4.2500000000000001'), r = await invoke(createV2Handler({ numeric: f.numeric }), '/v2/macro', { indicator: 'unemployment rate', country: 'IN', year: 2024 });
  assert.equal(r.body.error.code, 'NUMERIC_PRECISION_REFUSAL'); assert(!Object.hasOwn(r.body, 'rate_pct'));
});
test('macro refuses unsupported labels, missing required values and unavailable year without substitution', async () => {
  const f = macro(), h = createV2Handler({ numeric: f.numeric });
  for (const p of [{ indicator: 'inflation', country: 'IN', year: 2024 }, { indicator: 'unemployment rate', country: 'IN' }, { indicator: 'unemployment rate', country: 'India', year: 2024 }, { indicator: 'unemployment rate', country: 'IN', year: '2024.0' }]) {
    const r = await invoke(h, '/v2/macro', p); assert.equal(r.response.status, 422);
  }
  assert.equal(f.calls.length, 0);
  const missing = await invoke(h, '/v2/macro', { indicator: 'unemployment rate', country: 'IN', year: 2023 });
  assert.equal(missing.body.error.code, 'OBSERVATION_UNAVAILABLE'); assert(!Object.hasOwn(missing.body, 'rate_pct'));
});
test('mined lookup uses two actual mocked RPC operators and converts wei into whole ETH', async () => {
  const f = chain({ mutate: ({ method, result }) => { if (method === 'eth_getTransactionByHash') result.value = HEX('1250000000000000000'); return result; } });
  const { response, body } = await invoke(createV2Handler({ onchain: f.onchain }), '/v2/tx', { chain: 'Base Sepolia', tx_hash: TX });
  assert.equal(response.status, 200); assert.equal(body.status, 'confirmed'); assert.equal(body.block_number, 900); assert.equal(body.value_eth, 1.25); assert.equal(body.evidence.transaction.value_wei, '1250000000000000000');
  assert.equal(body.evidence.verification.sources.length, 2); assert(f.calls.some(c => c.operator === 0)); assert(f.calls.some(c => c.operator === 1));
  assert.equal(body.evidence.verification.cryptographic_state_proof, false); assert.match(body.interpretation.confirmed, /not Ethereum L1 finality/);
});
test('reverted transfer reports zero actual ETH transferred while preserving attempted transaction value', async () => {
  const f = chain({ state: 'reverted' });
  const r = await invoke(createV2Handler({ onchain: f.onchain }), '/v2/tx', { chain: 'base-sepolia', tx_hash: TX });
  assert.equal(r.response.status, 200); assert.equal(r.body.status, 'reverted'); assert.equal(r.body.value_eth, 0); assert.notEqual(r.body.evidence.transaction.value_wei, '0');
});
test('pending and unknown transactions cannot fabricate a scored block zero', async () => {
  for (const state of ['pending', 'unknown']) {
    const f = chain({ state }), r = await invoke(createV2Handler({ onchain: f.onchain }), '/v2/tx', { chain: 'base-sepolia', tx_hash: TX });
    assert.equal(r.body.error.code, 'UNSCORED_TRANSACTION_STATE'); assert.equal(r.body.verified_answer, false); assert(!Object.hasOwn(r.body, 'block_number'));
  }
});
test('lookup refuses lossy ETH JSON conversion, unsupported chain and RPC disagreement', async () => {
  const precise = chain({ mutate: ({ method, result }) => { if (method === 'eth_getTransactionByHash') result.value = HEX('1000000000000000001'); return result; } });
  const r = await invoke(createV2Handler({ onchain: precise.onchain }), '/v2/tx', { chain: 'base-sepolia', tx_hash: TX }); assert.equal(r.body.error.code, 'NUMERIC_PRECISION_REFUSAL');
  const f = chain({ mutate: ({ method, result, index }) => { if (method === 'eth_getTransactionReceipt' && index === 1) result.gasUsed = HEX(22000); return result; } });
  const bad = await invoke(createV2Handler({ onchain: f.onchain }), '/v2/tx', { chain: 'base-sepolia', tx_hash: TX }); assert.equal(bad.response.status, 503); assert(!Object.hasOwn(bad.body, 'block_number'));
  const unsupported = chain(), u = await invoke(createV2Handler({ onchain: unsupported.onchain }), '/v2/tx', { chain: 'ethereum', tx_hash: TX }); assert.equal(u.body.error.code, 'UNSUPPORTED_CHAIN'); assert.equal(unsupported.calls.length, 0);
});
test('native wallet reports whole ETH at the fresh hash-pinned block, not raw wei', async () => {
  const f = chain({ mutate: ({ method, result }) => method === 'eth_getBalance' ? HEX('1234560000000000000') : result });
  const h = createV2Handler({ onchain: f.onchain });
  for (const token of [undefined, '']) {
    const r = await invoke(h, '/v2/wallet', { chain: 'base-sepolia', address: A, ...(token === undefined ? {} : { token }) }, 'POST');
    assert.equal(r.response.status, 200); assert.equal(r.body.balance, 1.23456); assert.equal(r.body.token_symbol, 'ETH'); assert.equal(r.body.evidence.value_raw, '1234560000000000000');
    assert.equal(r.body.request_schema_version, 1); assert.equal(r.body.response_format_version, 1);
    assert.equal(r.body.evidence.block.number, '998'); assert.equal(r.body.evidence.token_decimals, '18'); assert.equal(r.body.as_of, new Date(NOW).toISOString());
  }
  const reads = f.calls.flatMap(c => c.methods.map((m, i) => ({ m, p: c.params[i] }))).filter(c => c.m === 'eth_getBalance'); assert(reads.every(c => c.p[1].requireCanonical === true && /^0x/.test(c.p[1].blockHash)));
});
test('wallet refuses exact balances that JSON would silently round, ENS and unsupported token metadata', async () => {
  const f = chain(), h = createV2Handler({ onchain: f.onchain });
  const lossy = await invoke(h, '/v2/wallet', { chain: 'base-sepolia', address: A }); assert.equal(lossy.body.error.code, 'NUMERIC_PRECISION_REFUSAL');
  const g = chain(), gh = createV2Handler({ onchain: g.onchain });
  for (const p of [{ chain: 'base', address: 'alice.eth' }, { address: A }, { chain: 'base', address: A, token: 'USDC' }, { chain: 'base', address: A, token: TOKEN }]) {
    const r = await invoke(gh, '/v2/wallet', p); assert.equal(r.response.status, 422); assert(!Object.hasOwn(r.body, 'balance'));
  }
  assert.equal(g.calls.length, 0);
});
test('current temperature is a real attributed station observation with correct concrete response field', async () => {
  const f = weather(), r = await invoke(createV2Handler({ weatherMiner: f.weatherMiner }), '/v2/weather/current', { location: '25.7617,-80.1918' });
  assert.equal(r.response.status, 200); assert.equal(r.body.temperature_c, 21.125); assert.equal(r.body.evidence.station.id, 'KMIA'); assert.equal(r.body.evidence.observed_at, '2026-11-01T05:00:00Z'); assert.equal(r.body.response_format_version, 1);
  assert.equal(r.body.evidence.sources.length, 3); assert.match(r.body.interpretation.coverage, /not a measurement at the exact point/);
});
test('forecast maps the complete requested future window and peak hourly probability', async () => {
  const f = weather(), r = await invoke(createV2Handler({ weatherMiner: f.weatherMiner }), '/v2/weather/forecast', { location: '25.7617,-80.1918', window_hours: 4 }, 'POST');
  assert.equal(r.response.status, 200); assert.equal(r.body.temp_max_c, 22); assert.equal(r.body.temp_min_c, 20); assert.equal(r.body.precipitation_probability_pct, 60);
  assert.equal(r.body.when, '2026-11-01T06:00:00.000Z/2026-11-01T10:00:00.000Z'); assert.equal(r.body.condition, 'Cloudy; Rain'); assert.equal(r.body.evidence.hourly.length, 4); assert.match(r.body.interpretation.precipitation_probability_pct, /not probability of any/);
});
test('weather rejects guessed cities, shifted windows and excess coordinate precision before source calls', async () => {
  const f = weather(), h = createV2Handler({ weatherMiner: f.weatherMiner });
  for (const p of [{ location: 'Miami', window_hours: 4 }, { location: '25.76170,-80.1918', window_hours: 4 }, { location: '91,0', window_hours: 4 }, { location: '25.7617,-80.1918', window_hours: 49 }, { location: '25.7617,-80.1918', window_hours: 0 }, { location: '25.7617,-80.1918' }]) {
    const r = await invoke(h, '/v2/weather/forecast', p); assert.equal(r.response.status, 422);
  }
  assert.equal(f.calls.length, 0);
});
test('weather never fills missing precipitation, stale observations or canonical out-of-range temperatures', async () => {
  const f = weather((b, p) => { if (p.endsWith('/hourly')) b.properties.periods[0].probabilityOfPrecipitation.value = null; });
  const r = await invoke(createV2Handler({ weatherMiner: f.weatherMiner }), '/v2/weather/forecast', { location: '25.7617,-80.1918', window_hours: 2 }); assert.equal(r.body.error.code, 'INCOMPLETE_PRECIPITATION'); assert(!Object.hasOwn(r.body, 'temp_max_c'));
  const g = weather((b, p) => { if (p.includes('/observations/')) b.properties.temperature.value = 65; });
  const range = await invoke(createV2Handler({ weatherMiner: g.weatherMiner }), '/v2/weather/current', { location: '25.7617,-80.1918' }); assert.equal(range.body.error.code, 'CANONICAL_RANGE_REFUSAL');
});
test('HTTP boundary rejects unknown, nested, duplicate and conflicting parameters and unsafe methods', async () => {
  const f = macro(), h = createV2Handler({ numeric: f.numeric }), p = { indicator: 'unemployment rate', country: 'IN', year: 2024 };
  const requests = [request('/v2/macro', { ...p, source_url: 'https://evil.test' }), request('/v2/macro', { ...p, country: { iso: 'IN' } }, 'POST'), new Request('https://provider.test/v2/macro?country=IN&country=US'), new Request('https://provider.test/v2/macro?country=US', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }), new Request('https://provider.test/v2/macro', { method: 'DELETE' }), new Request('https://provider.test/v2/macro', { method: 'POST', body: JSON.stringify(p) }), new Request('https://provider.test/v2/macro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ country: 'x'.repeat(5000) }) })];
  for (const req of requests) { const r = await h(req), body = await r.json(); assert(r.status >= 400); assert.equal(body.verified_answer, false); assert(!Object.hasOwn(body, 'rate_pct')); assert.equal(r.headers.get('cache-control'), 'no-store'); }
  assert.equal(f.calls.length, 0); assert.equal((await h(request('/fx'))).status, 404);
});
test('unexpected exceptions are redacted and unproven injected source answers are refused', async () => {
  const p = { indicator: 'unemployment rate', country: 'IN', year: 2024 };
  const error = await invoke(createV2Handler({ numeric: { macro: async () => { throw new Error('secret upstream token'); } } }), '/v2/macro', p);
  assert.equal(error.response.status, 500); assert.equal(error.body.error.code, 'INTERNAL_ERROR'); assert(!JSON.stringify(error.body).includes('secret'));
  const unproven = await invoke(createV2Handler({ numeric: { macro: async () => ({ status: 'ok', value: '4.25' }) } }), '/v2/macro', p); assert.equal(unproven.body.error.code, 'INVALID_SOURCE_RESULT');
});
test('duplicate JSON fields, including escaped aliases, are refused before source access', async () => {
  const f = macro(), h = createV2Handler({ numeric: f.numeric });
  for (const raw of ['{"country":"IN","country":"US"}', '{"country":"IN","countr\\u0079":"US"}']) {
    const response = await h(new Request('https://provider.test/v2/macro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }));
    assert.equal((await response.json()).error.code, 'DUPLICATE_PARAMETER');
  }
  assert.equal(f.calls.length, 0);
});
test('concurrency capacity is released after both source success and failure', async () => {
  let release; const blocked = new Promise(resolve => release = resolve), f = macro();
  const h = createV2Handler({ numeric: { macro: async p => { await blocked; return f.numeric.macro(p); } }, maxConcurrent: 1 }), p = { indicator: 'unemployment rate', country: 'IN', year: 2024 };
  const pending = invoke(h, '/v2/macro', p); const overloaded = await invoke(h, '/v2/macro', p); assert.equal(overloaded.body.error.code, 'CAPACITY_LIMIT'); release(); assert.equal((await pending).response.status, 200); assert.equal((await invoke(h, '/v2/macro', p)).response.status, 200);
  let attempt = 0; const recovering = createV2Handler({ maxConcurrent: 1, numeric: { macro: async p => { if (++attempt === 1) throw new Error('first call failed'); return f.numeric.macro(p); } } });
  assert.equal((await invoke(recovering, '/v2/macro', p)).response.status, 500); assert.equal((await invoke(recovering, '/v2/macro', p)).response.status, 200);
  assert.throws(() => createV2Handler({ maxConcurrent: 0 }), TypeError);
});
