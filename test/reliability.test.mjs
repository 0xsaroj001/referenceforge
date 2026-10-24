import test from 'node:test';
import assert from 'node:assert/strict';
import { createSources } from '../src/upstream.mjs';
import { parseMacroInput, createMiner } from '../src/miner.mjs';
const url = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

test('transient source failure retries within one load and preserves cached provenance', async () => {
  let calls = 0; const sources = createSources({ retryDelayMs: 0, fetchImpl: async () => ++calls === 1 ? new Response('temporary', { status: 503 }) : new Response('official source') });
  const [a, b] = await Promise.all([sources.get(url, 1000), sources.get(url, 1000)]);
  const c = await sources.get(url, 1000);
  assert.equal(calls, 2); assert.equal(a.payload_sha256, b.payload_sha256); assert.equal(c.fetched_at, a.fetched_at); assert.equal(c.cache_hit, true);
  assert.equal(sources.stats().loads, 1); assert.equal(sources.stats().retries, 1); assert.equal(sources.stats().coalesced, 1);
});

test('permanent errors and excessive Retry-After do not trigger repeated calls', async () => {
  for (const [status, headers] of [[404, {}], [429, { 'retry-after': '9999' }]]) {
    let calls = 0; const sources = createSources({ retryDelayMs: 0, fetchImpl: async () => { calls++; return new Response('no', { status, headers }); } });
    await assert.rejects(sources.get(url, 1), { code: 'SOURCE_HTTP_ERROR' }); assert.equal(calls, 1);
  }
});

test('edge-compatible manual redirect handling never follows another source host', async () => {
  let calls=0;const sources=createSources({fetchImpl:async (_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://evil.example/'}});}});
  await assert.rejects(sources.get(url,1000),{code:'SOURCE_REDIRECT'});assert.equal(calls,1);
});

test('supported annual unemployment and incompatible units are distinguished', () => {
  assert.deepEqual(parseMacroInput({ question: 'US unemployment rate 2019' }), { country: 'US', indicator: 'unemployment', year: '2019' });
  for (const question of ['India GDP per capita 2024', 'India GDP PPP 2024', 'India real GDP 2024', 'India CPI index 2024', 'India policy rate 2024']) assert.throws(() => parseMacroInput({ question }), { code: 'UNSUPPORTED_UNIT' });
});

test('duplicate source observations are refused instead of arbitrarily choosing one', async () => {
  const row = { date: '2019', country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', indicator: { id: 'SL.UEM.TOTL.ZS' }, value: 3.669 };
  const miner = createMiner({ sources: { get: async () => ({ text: JSON.stringify([{ pages: 1, lastupdated: '2026-10-08' }, [row, { ...row, value: 4 }]]) }) } });
  await assert.rejects(miner.macro({ country: 'US', indicator: 'unemployment', year: '2019' }), { code: 'BAD_SOURCE' });
});
