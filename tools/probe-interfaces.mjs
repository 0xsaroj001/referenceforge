import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const targets = [
  ['canonical_intents', 'https://devnode.telegraphprotocol.com/engine/v1/intents'],
  ['fx_registry', 'https://devnode.telegraphprotocol.com/api/wasm?intent=FX_NOW'],
  ['macro_registry', 'https://devnode.telegraphprotocol.com/api/wasm?intent=MACRO_ECONOMIC_INDICATOR'],
  ['resolve_probe', 'https://devnode.telegraphprotocol.com/api/wasm?resolve=FX_NOW'],
  ['fx_engine_registry', 'https://devnode.telegraphprotocol.com/engine/v1/intents/FX_NOW/wasm'],
  ['evaluation_pool', 'https://devnode.telegraphprotocol.com/api/evalpool/status?intent_id=FX_NOW']
];
const probes = await Promise.all(targets.map(async ([name, url]) => {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await response.text(); let body;
    try { body = JSON.parse(text); } catch { body = null; }
    const item = { name, url, status: response.status, bytes: Buffer.byteLength(text), response_sha256: createHash('sha256').update(text).digest('hex'), duration_ms: performance.now() - started };
    if (name === 'canonical_intents') item.canonical_names = (body?.intents ?? []).map(x => x.intent_id);
    if (body?.intents && !Array.isArray(body.intents)) item.returned_intent_keys = Object.keys(body.intents);
    if (name === 'fx_engine_registry') item.record_intents = (body?.wasm ?? []).map(x => x.IntentID);
    if (name === 'evaluation_pool') item.body = body ?? text.slice(0, 200);
    return item;
  } catch (error) { return { name, url, error: error.message, cause: error.cause?.code }; }
}));
// Invalid YAML deliberately cannot become a registration. No keys or identity.
try {
  const response = await fetch('https://integrate.telegraphprotocol.com/api/validate', { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yaml: 'version: "1"\nkind: miner\n' }) });
  const body = await response.text();
  probes.push({ name: 'invalid_yaml_validation', url: 'https://integrate.telegraphprotocol.com/api/validate', method: 'POST', status: response.status, body: body.slice(0, 1500), note: 'Incomplete YAML; no registration, wallet, API key or credential staging requested.' });
} catch (error) { probes.push({ name: 'invalid_yaml_validation', error: error.message, cause: error.cause?.code }); }
const resolveProbe = probes.find(x => x.name === 'resolve_probe');
const engineProbe = probes.find(x => x.name === 'fx_engine_registry');
const report = { checked_at: new Date().toISOString(), probes,
  assessment: {
    resolve_obeys_requested_intent: resolveProbe?.status === 200 ? (resolveProbe.returned_intent_keys ?? []).every(x => x === 'FX_NOW') : null,
    engine_route_obeys_requested_intent: engineProbe?.status === 200 ? (engineProbe.record_intents ?? []).every(x => x === 'FX_NOW') : null,
    wasm_registration_admission: 'not tested; no on-chain registration or publication authorized',
    miner_registration: 'not performed',
    published_abi: 'Comparator imw_score_deterministic/i64 plus imw_alloc/imw_free; judgment/hybrid wide packages; legacy rank_answer retired in current documentation'
  }
};
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/interface-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checked_at: report.checked_at, probes: probes.map(({ canonical_names, ...rest }) => ({ ...rest, ...(canonical_names ? { canonical_count: canonical_names.length } : {}) })), assessment: report.assessment }, null, 2));
