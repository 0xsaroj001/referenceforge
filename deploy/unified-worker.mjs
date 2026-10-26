import { createUnifiedHandler } from '../src/unified.mjs';
import { createMiner } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { networksForEnv } from '../src/onchain/input.mjs';
import { failureResponse } from '../src/responses.mjs';
import { createWeather } from '../src/weather.mjs';

const assets = new Set(['/miner.yaml', '/referenceforge-unified.yaml', '/referenceforge-expanded.yaml', '/referenceforge-expanded-no-fx.yaml', '/referenceforge-weather.yaml', '/referenceforge-routing.yaml', '/referenceforge-comparator.wasm', '/artifact-manifest.json']);
export function createUnifiedWorker({ handlerFactory, expanded = false, weather = false, maxConcurrent = 8 } = {}) {
  if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>64)throw new Error('Invalid Worker concurrency limit');
  let activeRequests=0; // Admission counter only; no request I/O crosses requests.
  const numericCache = new Map(); // Bounded, resolved text only; validators run on every read.
  const weatherCache = new Map();
  const freshHandler = handlerFactory ?? ((env) => createUnifiedHandler({ expanded, weather,
  onFailure: detail => console.warn(JSON.stringify({service:'ReferenceForge',event:'request_failure',...detail})),
  weatherMiner: createWeather({cache:weatherCache,cacheApi:weather?globalThis.caches?.default:undefined}),
  numeric: createMiner({ sources: createSources({ cache: numericCache, onError: e => console.warn(JSON.stringify({ service: 'ReferenceForge', event: 'numeric_source_failure', code: e.code ?? e.name })) }) }),
  onchain: createOnchainMiner({ networks: networksForEnv(env), onRpcError: detail => console.warn(JSON.stringify({ service: 'ReferenceForge', event: 'rpc_failure', ...detail })) })
}));
  return { async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;
    if (assets.has(path)) {
      if (!['GET', 'HEAD'].includes(request.method)) return Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405, headers: { allow: 'GET, HEAD' } });
      if (!env.ASSETS) return Response.json({ error: { code: 'ASSETS_NOT_CONFIGURED' } }, { status: 503 });
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff');
      if (path.endsWith('.yaml')) headers.set('content-type', 'application/yaml; charset=utf-8');
      return new Response(response.body, { status: response.status, headers });
    }
    const admitted=path!=='/health';
    if(admitted&&activeRequests>=maxConcurrent){console.warn(JSON.stringify({service:'ReferenceForge',event:'admission_refused',code:'CAPACITY_LIMIT'}));return Response.json({status:'error',mode:'unavailable',fallback:false,verified_answer:false,error:{code:'CAPACITY_LIMIT',message:'Worker isolate concurrency limit reached; retry later'}},{status:503,headers:{'cache-control':'no-store'}});}
    if(admitted)activeRequests++;
    // No pending source fetch, abort signal or mutable RPC session crosses requests.
    let response;
    try { response = await freshHandler(env)(request); }
    catch(error) {const failure=failureResponse(error);response=Response.json(failure.body,{status:failure.status,headers:{'cache-control':'no-store'}});}
    finally {if(admitted)activeRequests--;}
    if(path==='/health'&&response.ok){const body=await response.json();response=Response.json({...body,rpc_configuration:env.ALCHEMY_API_KEY?'alchemy_account_plus_publicnode':'shared_public_rpcs'},{headers:{'cache-control':'no-store'}});}
    console.log(JSON.stringify({ service: 'ReferenceForge', path, status: response.status })); return response;
  } };
}
export default createUnifiedWorker();
