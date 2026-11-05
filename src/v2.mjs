import { createMiner } from './miner.mjs';
import { createOnchainMiner } from './onchain/verify.mjs';
import { createWeather } from './weather.mjs';
import { decimal } from './decimal.mjs';
import { ServiceError } from './errors.mjs';
import { failureResponse } from './responses.mjs';
import { boundedText } from './onchain/rpc.mjs';
import { address, hash, parseWallet } from './onchain/input.mjs';

export const V2_INTENTS = Object.freeze(['MACRO_ECONOMIC_INDICATOR_GENERAL', 'ONCHAIN_TX_LOOKUP_GENERAL', 'WALLET_BALANCE_CHECK_GENERAL', 'WEATHER_CHECK_TEMPERATURE', 'WEATHER_FORECAST_GENERAL']);
export const V2_PATHS = Object.freeze(['/v2/macro', '/v2/tx', '/v2/wallet', '/v2/weather/current', '/v2/weather/forecast']);
const fields = [['indicator', 'country', 'year'], ['chain', 'tx_hash'], ['chain', 'address', 'token'], ['location'], ['location', 'window_hours']];
// Request and response versions from the 4 November 2026 contract capture.
const versions = [[1, 1], [1, 1], [1, 1], [3, 1], [3, 3]];
const fail = (code, message, status = 422) => { throw new ServiceError(code, message, status); };
const insist = (ok, message) => { if (!ok) fail('INVALID_SOURCE_RESULT', message, 502); };
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
function exactNumber(value, min, max) {
  insist(['string', 'number'].includes(typeof value), 'Source number is missing.');
  let original, converted;
  const number = Number(value);
  try { original = decimal(value); converted = decimal(String(number)); } catch { fail('INVALID_SOURCE_RESULT', 'Source number is not a supported finite decimal.', 502); }
  if (!Number.isFinite(number) || number < min || number > max) fail('CANONICAL_RANGE_REFUSAL', 'Source number is outside the concrete intent range.');
  if (original.n * converted.d !== converted.n * original.d) fail('NUMERIC_PRECISION_REFUSAL', 'Canonical JSON number would lose exact source decimal precision.');
  return number;
}
function integer(value, min, max, name) {
  if (!['string', 'number'].includes(typeof value) || !/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail('INVALID_PARAMETER', `${name} must be an integer from ${min} through ${max}.`);
  return Number(value);
}
function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_PARAMETER', `${name} must be a nonempty bounded string.`);
  return value;
}
function coordinates(value) {
  const location = text(value, 'location');
  const m = /^\s*(-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4}))\s*,\s*(-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4}))\s*$/.exec(location);
  if (!m || Number(m[1]) < -90 || Number(m[1]) > 90 || Number(m[2]) < -180 || Number(m[2]) > 180) fail('UNSUPPORTED_LOCATION', 'Supply explicit latitude,longitude decimal degrees with at most four decimals; city names are not geocoded.');
  return { lat: Number(m[1]), lon: Number(m[2]) };
}
function provenance(source) {
  insist(source && typeof source.source_url === 'string' && source.source_url.startsWith('https://') && stamp(source.fetched_at) && digest(source.payload_sha256), 'Source attribution or payload digest is missing.');
}
function weatherResult(result, intent) {
  insist(result?.status === 'ok' && result.intent === intent && result.verified_answer === true && result.fallback === false && Array.isArray(result.sources) && result.sources.length >= 2, 'Weather source did not produce an attributed answer.');
  result.sources.forEach(provenance);
}
function chainResult(result, intent, chain) {
  insist(result?.status === 'ok' && result.intent === intent && result.network === chain && result.chain_id === (chain === 'base' ? '8453' : '84532') && result.verification?.method === 'two_operator_exact_agreement' && result.verification.cryptographic_state_proof === false && result.verification.sources?.length === 2, 'RPC result lacks the expected chain or independent source evidence.');
  for (const source of result.verification.sources) insist(typeof source.operator === 'string' && source.batches?.length > 0 && source.batches.every(b => digest(b.response_sha256)), 'RPC response digests are missing.');
}
function weiUnits(raw) {
  insist(typeof raw === 'string' && /^(0|[1-9][0-9]*)$/.test(raw), 'Transaction value is not an exact unsigned wei amount.');
  const padded = raw.padStart(19, '0');
  return padded.slice(0, -18) + '.' + padded.slice(-18);
}
function bodyObject(raw) {
  const body = JSON.parse(raw);
  if (!body || Array.isArray(body) || typeof body !== 'object') fail('INVALID_BODY', 'Expected one flat JSON object.');
  // JSON.parse alone silently keeps the last duplicate key. Inspect top-level
  // JSON string tokens after syntax validation, including escaped field names.
  let depth = 0;
  const keys = new Set();
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') {
      const start = i++;
      for (; i < raw.length; i++) { if (raw[i] === '\\') i++; else if (raw[i] === '"') break; }
      let next = i + 1; while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
      if (depth === 1 && raw[next] === ':') {
        const key = JSON.parse(raw.slice(start, i + 1));
        if (keys.has(key)) fail('DUPLICATE_PARAMETER', 'Duplicate JSON parameter.');
        keys.add(key);
      }
    } else if (raw[i] === '{' || raw[i] === '[') depth++;
    else if (raw[i] === '}' || raw[i] === ']') depth--;
  }
  return body;
}

// Compatibility output preserves our original evidence. Anjoman node shaping,
// field statuses, admission and scoring are separate operations, not claimed here.
export function createV2Handler({ numeric = createMiner(), onchain = createOnchainMiner(), weatherMiner = createWeather(), locationResolver, maxConcurrent = 8, onDiagnostic = () => {} } = {}) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64) throw new TypeError('maxConcurrent must be 1..64');
  let active = 0;
  return async request => {
    let admitted = false;
    const started = performance.now(), requestId = crypto.randomUUID();
    const index = V2_PATHS.indexOf(new URL(request.url).pathname);
    const diagnostic = {
      diagnostic_version: 1, request_id: requestId,
      endpoint: V2_PATHS[index] ?? 'unknown', intent: V2_INTENTS[index] ?? null,
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method) ? request.method : 'OTHER',
      stage: 'validation'
    };
    const send = (status, body) => {
      diagnostic.http_status = status;
      diagnostic.error_code = body.error?.code ?? null;
      diagnostic.request_schema_version = body.request_schema_version ?? null;
      diagnostic.response_format_version = body.response_format_version ?? null;
      return Response.json(body, { status, headers: {
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'x-referenceforge-request-id': requestId
      } });
    };
    try {
      const url = new URL(request.url);
      if (index < 0) fail('NOT_FOUND', 'Unknown V2 endpoint.', 404);
      if (!['GET', 'POST'].includes(request.method)) fail('METHOD_NOT_ALLOWED', 'Use GET or POST JSON.', 405);
      if (active >= maxConcurrent) fail('CAPACITY_LIMIT', 'V2 handler concurrency limit reached.', 503);
      active++; admitted = true;
      const p = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(p, key)) fail('DUPLICATE_PARAMETER', 'Duplicate query parameter.');
        p[key] = value;
      }
      if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) fail('UNSUPPORTED_MEDIA_TYPE', 'POST requires application/json.', 415);
        let body;
        try { body = bodyObject(await boundedText(request, 4096, request.signal)); } catch (error) { if (error instanceof ServiceError) throw error; fail('INVALID_BODY', 'Expected a JSON object no larger than 4096 bytes.'); }
        for (const [key, value] of Object.entries(body)) {
          if (Object.hasOwn(p, key) && String(p[key]) !== String(value)) fail('CONFLICTING_PARAMETER', 'Query and body parameters disagree.');
          p[key] = value;
        }
      }
      if (Object.keys(p).some(k => !fields[index].includes(k))) fail('UNSUPPORTED_PARAMETER', 'Use only the concrete intent canonical parameters.');
      if (Object.values(p).some(v => !['string', 'number'].includes(typeof v) || String(v).length > 256 || typeof v === 'number' && !Number.isFinite(v))) fail('INVALID_PARAMETER', 'Parameters must be bounded strings or finite numbers.');
      let result, answer, policy;
      if (index === 0) {
        if (p.indicator !== 'unemployment rate') fail('UNSUPPORTED_INDICATOR', 'This concrete intent supports indicator exactly unemployment rate.');
        const country = text(p.country, 'country'), year = integer(p.year, 1960, 2100, 'year');
        if (!/^[A-Za-z]{2,3}$/.test(country)) fail('UNSUPPORTED_COUNTRY', 'Supply an explicit ISO two- or three-letter country code.');
        diagnostic.stage = 'source';
        result = await numeric.macro({ indicator: 'unemployment', country, year });
        diagnostic.stage = 'verification';
        insist(result?.status === 'ok' && result.intent === 'MACRO_ECONOMIC_INDICATOR' && result.fallback === false && result.indicator_id === 'SL.UEM.TOTL.ZS' && result.observation_year === year && result.country === country.toUpperCase(), 'Annual unemployment source identity or requested period differs.');
        provenance(result.source);
        answer = { rate_pct: exactNumber(result.value, 0, 100) };
      } else if (index === 1 || index === 2) {
        const normalized = parseWallet({ chain: text(p.chain, 'chain'), address: index === 2 ? address(p.address) : '0x' + '11'.repeat(20) });
        if (index === 1) {
          const tx_hash = hash(p.tx_hash);
          diagnostic.stage = 'source';
          result = await onchain.lookup({ chain: normalized.chain, tx_hash }, { signal: request.signal });
          diagnostic.stage = 'verification';
          diagnostic.transaction_state = ['mined_success', 'reverted', 'pending', 'unknown'].includes(result?.state) ? result.state : 'invalid';
          chainResult(result, 'ONCHAIN_TX_LOOKUP', normalized.chain);
          if (!result.verified_answer || !['mined_success', 'reverted'].includes(result.state)) fail('UNSCORED_TRANSACTION_STATE', 'Pending or unknown transaction cannot supply the mandatory scored mined block number.');
          insist(result.transaction?.hash === tx_hash && result.receipt?.tx_hash === tx_hash && result.transaction.block_number === result.receipt.block_number && ['0', '1'].includes(result.receipt.status), 'Transaction and receipt identity differ.');
          insist((result.state === 'reverted') === (result.receipt.status === '0'), 'Transaction execution state conflicts with receipt.');
          // Contract creation has no recipient address; do not manufacture one.
          if (result.transaction.to === null) fail('UNSUPPORTED_TRANSACTION_KIND', 'Contract creation has no recipient string for this concrete response.');
          answer = { tx_hash, status: result.state === 'reverted' ? 'reverted' : 'confirmed', from: address(result.transaction.from), to: address(result.transaction.to), block_number: exactNumber(result.receipt.block_number, 0, 1e12), value_eth: result.state === 'reverted' ? 0 : exactNumber(weiUnits(result.transaction.value_wei), 0, 1e12) };
          policy = { value_eth: 'Top-level native ETH actually transferred by this transaction; zero on reverted execution. Excludes internal transfers and gas fees.', confirmed: 'Canonical L2 block inclusion agreed by two RPC operators; not Ethereum L1 finality.' };
        } else {
          const token = p.token === '' ? undefined : p.token;
          if (token !== undefined) { address(token, 'token'); fail('UNSUPPORTED_TOKEN_METADATA', 'ERC20 symbol metadata is not implemented; only native ETH balance is currently served.'); }
          diagnostic.stage = 'source';
          result = await onchain.wallet({ chain: normalized.chain, address: normalized.address }, { signal: request.signal });
          diagnostic.stage = 'verification';
          chainResult(result, 'WALLET_BALANCE_CHECK', normalized.chain);
          insist(result.verified_answer === true && result.address === normalized.address && result.token === null && result.token_decimals === '18' && stamp(result.observed_at), 'Native wallet result identity or units differ.');
          answer = { address: result.address, chain: result.network, balance: exactNumber(result.balance, 0, 1e15), token_symbol: 'ETH', as_of: result.observed_at };
          policy = { balance: 'Exact whole ETH units at the disclosed fresh common head minus two blocks; no decimal rounding.', as_of: 'Retrieval timestamp; the original evidence also contains the block timestamp and hash.' };
        }
      } else {
        let location, resolvedPlace;
        try { location = coordinates(p.location); }
        catch(error) {
          // Coordinate typos/range failures keep their existing refusal. Named
          // places require an explicitly configured, pinned offline resolver.
          if(!locationResolver||error.code!=='UNSUPPORTED_LOCATION'||/^\s*[-+\d.]+\s*,\s*[-+\d.]+\s*$/.test(p.location??''))throw error;
          try { resolvedPlace=locationResolver(p.location);location={lat:resolvedPlace.latitude,lon:resolvedPlace.longitude}; }
          catch(error) { fail(error.code??'UNSUPPORTED_LOCATION','Use an exact supported US Census place name and explicit state; ambiguous, unknown and fuzzy names are refused.'); }
        }
        if (index === 3) {
          diagnostic.stage = 'source';
          result = await weatherMiner.current({ ...location, metric: 'temperature' }, { signal: request.signal });
          diagnostic.stage = 'verification';
          weatherResult(result, 'WEATHER_CHECK');
          answer = { temperature_c: exactNumber(result.metrics?.temperature, -90, 60) };
          policy = { coverage: 'NWS-covered US land coordinates; recent station measurement within 50 km, not a measurement at the exact point.' };
        } else {
          const hours = integer(p.window_hours, 1, 240, 'window_hours');
          if (hours > 48) fail('UNSUPPORTED_WINDOW', 'This provider supports complete future hourly windows of 1..48 hours; longer requests are not truncated.');
          diagnostic.stage = 'source';
          result = await weatherMiner.forecast({ ...location, hours }, { signal: request.signal });
          diagnostic.stage = 'verification';
          weatherResult(result, 'WEATHER_FORECAST');
          insist(result.window?.hours === hours && result.hourly?.length === hours && stamp(result.window.start_time) && stamp(result.window.end_time), 'Weather source window differs from requested hours.');
          if (result.metrics?.precipitation_probability_max === null) fail('INCOMPLETE_PRECIPITATION', 'Cannot provide complete-window probability when one or more hourly probabilities are unavailable.');
          const condition = [...new Set(result.hourly.map(h => h.conditions))].join('; ');
          insist(condition.length > 0 && condition.length <= 4096 && result.hourly.every(h => typeof h.conditions === 'string' && h.conditions.length > 0), 'Weather conditions are missing or exceed bounds.');
          answer = { location: `${location.lat},${location.lon}`, when: `${result.window.start_time}/${result.window.end_time}`, temp_max_c: exactNumber(result.metrics.temperature_max, -90, 60), temp_min_c: exactNumber(result.metrics.temperature_min, -90, 60), precipitation_probability_pct: exactNumber(result.metrics.precipitation_probability_max, 0, 100), condition };
          insist(answer.temp_min_c <= answer.temp_max_c, 'Forecast minimum exceeds maximum.');
          policy = { coverage: 'NWS-covered US land coordinates, complete 1..48 future hourly windows.', precipitation_probability_pct: 'Maximum of source hourly probabilities, not probability of any precipitation over the full window.', temperature: 'Uses existing service Celsius normalization to three decimals; native evidence retains hourly values and source payload digests.' };
        }
        if(resolvedPlace)policy.location_resolution=resolvedPlace;
      }
      diagnostic.stage = 'response';
      diagnostic.canonical_fields = Object.keys(answer);
      return send(200, { provider_status: 'ok', intent: V2_INTENTS[index], request_schema_version: versions[index][0], response_format_version: versions[index][1], ...answer, ...(policy ? { interpretation: policy } : {}), evidence: result });
    } catch (error) { const failure = failureResponse(error); return send(failure.status, failure.body); }
    finally {
      if (admitted) active--;
      diagnostic.elapsed_ms = Math.max(0, Math.round(performance.now() - started));
      // A diagnostic sink receives only bounded metadata. Its
      // failure cannot change fulfillment or retain the request's admission.
      try { await onDiagnostic(diagnostic); } catch {}
    }
  };
}
