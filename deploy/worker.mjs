import { createMiner, responseDigest } from '../src/miner.mjs';
import { ServiceError } from '../src/errors.mjs';
import { createSources } from '../src/upstream.mjs';
import { failureResponse, serviceHealth } from '../src/responses.mjs';

export function createWorker({ miner = createMiner({ sources: createSources({ onError: e => console.error('ReferenceForge source failure:', e.name, e.message) }) }) } = {}) {
  return {
    async fetch(request, env = {}) {
      const started = performance.now();
      const send = (status, body) => new Response(JSON.stringify(body) + '\n', { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      try {
        const url = new URL(request.url);
        if (['/miner.yaml', '/referenceforge-comparator.wasm', '/artifact-manifest.json'].includes(url.pathname) && request.method === 'GET') {
          if (!env.ASSETS) throw new ServiceError('ASSETS_NOT_CONFIGURED', 'Deployment assets are not configured', 503);
          return env.ASSETS.fetch(request);
        }
        if (url.pathname === '/health' && request.method === 'GET') return send(200, serviceHealth());
        if (!['/fx', '/macro'].includes(url.pathname)) throw new ServiceError('NOT_FOUND', 'Unknown endpoint', 404);
        if (!['GET', 'POST'].includes(request.method)) throw new ServiceError('METHOD_NOT_ALLOWED', 'Use GET query parameters or POST JSON', 405);
        let params = Object.fromEntries(url.searchParams);
        if (request.method === 'POST') {
          if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) throw new ServiceError('UNSUPPORTED_MEDIA_TYPE', 'POST requires application/json', 415);
          const reader = request.body?.getReader();const chunks=[];let size=0;
          if (reader) try { for (;;) { const { value, done } = await reader.read();if (done) break;size += value.byteLength;if(size>65536){await reader.cancel();throw new ServiceError('BODY_TOO_LARGE','Request exceeds 64 KiB',413);}chunks.push(value); } } finally {reader.releaseLock();}
          const bytes = new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
          try {const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();params={...params,...body};}
          catch {throw new ServiceError('INVALID_JSON','Expected one JSON object',400);}
        }
        if(Object.values(params).some(v=>v!==null&&!['string','number'].includes(typeof v)))throw new ServiceError('INVALID_PARAMETER','Parameters must be scalar strings or numbers',400);
        const result=await(url.pathname==='/fx'?miner.fx(params):miner.macro(params));
        return send(200,{...result,local_content_sha256:responseDigest(result),duration_ms:Math.round((performance.now()-started)*1000)/1000});
      } catch(error) {const failure=failureResponse(error);return send(failure.status,failure.body);}
    }
  };
}
export default createWorker();
