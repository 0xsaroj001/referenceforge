import { createMiner, responseDigest } from './miner.mjs';
import { ServiceError } from './errors.mjs';
import { failureResponse } from './responses.mjs';
import { createOnchainMiner } from './onchain/verify.mjs';
import { boundedText } from './onchain/rpc.mjs';
import { createWeather, WEATHER_INTENTS, WEATHER_PATHS } from './weather.mjs';
import { METRIC_ROUTES, metricRouteParams, parameterShape } from './onchain/routes.mjs';

export const UNIFIED_INTENTS = Object.freeze(['FX_NOW', 'MACRO_ECONOMIC_INDICATOR', 'CRYPTO_TRANSFER_VERIFY', 'ONCHAIN_METRIC_VERIFY']);
export const UNIFIED_PATHS = Object.freeze(['/fx', '/macro', '/verify-transfer', '/onchain-metric']);
export const EXPANDED_INTENTS = Object.freeze([...UNIFIED_INTENTS, 'CURRENCY_EXCHANGE', 'ONCHAIN_TX_LOOKUP', 'WALLET_BALANCE_CHECK']);
export const EXPANDED_PATHS = Object.freeze([...UNIFIED_PATHS, '/convert', '/tx', '/wallet-balance']);
const fail = (code, message, status = 400) => { throw new ServiceError(code, message, status); };
export function unifiedHealth(expanded = false, weather = false) {
  return { status: 'ok', service: 'ReferenceForge', version: weather ? '0.5.2' : expanded ? '0.4.0' : '0.3.0', supported_intents: weather ? [...EXPANDED_INTENTS,...WEATHER_INTENTS] : expanded ? EXPANDED_INTENTS : UNIFIED_INTENTS,
    endpoints: weather ? [...EXPANDED_PATHS,...WEATHER_PATHS,...Object.keys(METRIC_ROUTES)] : expanded ? EXPANDED_PATHS : UNIFIED_PATHS, ...(weather?{routing_contract_version:'explicit_metrics_v1',weather_coverage:'NWS-covered US land points; forecasts 1-48 hours, observations <=90 minutes within 50 km, issued alerts for next 24 hours'}:{}), supported_networks: ['base', 'base-sepolia'], payment_flow_verified: false,
    registration_status: 'check_registry_and_node', scope: 'ECB daily references, World Bank annual observations, Base native/ERC20 transfers and block-pinned metrics' };
}
export function createUnifiedHandler({ numeric = createMiner(), onchain = createOnchainMiner(), weatherMiner = createWeather(), maxConcurrent = 8, expanded = false, weather = false, onFailure = ()=>{} } = {}) {
  let active = 0;
  return async request => {
    const started = performance.now(); let admitted = false, endpoint='unrecognized', shape=[];
    const send = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    try {
      const url = new URL(request.url), metricAlias=weather&&Object.hasOwn(METRIC_ROUTES,url.pathname), index = metricAlias?3:(weather ? [...EXPANDED_PATHS,...WEATHER_PATHS] : expanded ? EXPANDED_PATHS : UNIFIED_PATHS).indexOf(url.pathname), numericRoute = index < 2 || index === 4;
      if(index>=0)endpoint=url.pathname;
      if (url.pathname === '/health' && request.method === 'GET') return send(200, unifiedHealth(expanded,weather));
      if (index < 0) fail('NOT_FOUND', 'Unknown endpoint', 404);
      if (!['GET', 'POST'].includes(request.method)) fail('METHOD_NOT_ALLOWED', 'Use GET or POST JSON', 405);
      if (active >= maxConcurrent) fail('CAPACITY_LIMIT', 'Service handler concurrency limit reached', 503);
      active++; admitted = true;
      const params = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(params, key)) fail('DUPLICATE_PARAMETER', 'Duplicate query parameter'); params[key] = value;
      }
      if (request.method === 'POST') {
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) fail('UNSUPPORTED_MEDIA_TYPE', 'POST requires application/json', 415);
        let body;
        try { body = JSON.parse(await boundedText(request, numericRoute ? 65536 : 16384, request.signal)); }
        catch { fail('INVALID_BODY', 'Expected a bounded JSON object'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') fail('INVALID_BODY', 'Expected one JSON object');
        for (const [key, value] of Object.entries(body)) {
          if (Object.hasOwn(params, key) && params[key] !== value) fail('CONFLICTING_PARAMETER', 'Body and query parameters disagree'); params[key] = value;
        }
      }
      if (Object.keys(params).length > 12 || Object.values(params).some(v => !['string', 'number'].includes(typeof v) || String(v).length > (numericRoute ? 4096 : 256))) fail('INVALID_PARAMETER', 'Parameters exceed supported type, count or length bounds');
      shape=parameterShape(params);
      let original = index === 0 || index === 4 ? await numeric.fx(params) : index === 1 ? await numeric.macro(params)
        : index === 2 ? await onchain.transfer(params, { signal: request.signal }) : index === 3 ? await onchain.metric(metricAlias?metricRouteParams(url.pathname,params):params, { signal: request.signal })
        : index === 5 ? await onchain.lookup(params, { signal: request.signal }) : index === 6 ? await onchain.wallet(params, { signal: request.signal })
        : await weatherMiner[['forecast','current','alerts'][index-7]](params,{signal:request.signal});
      if (index === 4) original = { ...original, intent: 'CURRENCY_EXCHANGE', numeric_value: original.converted_amount, unit: original.quote,
        summary: `${original.amount} ${original.base} = ${original.converted_amount} ${original.quote} using the ECB daily reference rate dated ${original.observation_date}. This is reference information, not an executable quote.` };
      // One top-level signal mapping serves every intent. Preserve exact strings and
      // all original provenance, periods and evidence; never synthesize a value for errors.
      const result = numericRoute ? { ...original, score_value: original.numeric_value } : original;
      const inconclusive = !numericRoute && result.verified_answer === false && result.fulfillment === 'inconclusive' && result.score_value === null;
      if ((!inconclusive && typeof result.score_value !== 'string') || !result.summary) fail('INVALID_RESULT', 'Result lacks its exact score or explicit inconclusive state', 502);
      return send(200, { ...result, ...(numericRoute ? { local_content_sha256: responseDigest(result) } : {}), duration_ms: Math.round((performance.now() - started) * 1000) / 1000 });
    } catch (error) { const failure = failureResponse(error);if(endpoint!=='unrecognized')try{onFailure({endpoint,status:failure.status,code:failure.body.error.code,parameter_shape:shape});}catch{}return send(failure.status, failure.body); }
    finally { if (admitted) active--; }
  };
}
