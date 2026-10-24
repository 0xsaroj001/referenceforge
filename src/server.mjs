import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMiner, responseDigest } from './miner.mjs';
import { ServiceError } from './errors.mjs';
import { failureResponse, serviceHealth } from './responses.mjs';

export function createServer({ miner = createMiner() } = {}) {
  const server = http.createServer(async (request, response) => {
    const started = performance.now();
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body) + '\n');
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/health' && request.method === 'GET') {
        send(200, serviceHealth()); return;
      }
      if (!['/fx', '/macro'].includes(url.pathname)) throw new ServiceError('NOT_FOUND', 'Unknown endpoint', 404);
      if (!['GET', 'POST'].includes(request.method)) throw new ServiceError('METHOD_NOT_ALLOWED', 'Use GET query parameters or POST JSON', 405);
      let params = Object.fromEntries(url.searchParams);
      if (request.method === 'POST') {
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw new ServiceError('UNSUPPORTED_MEDIA_TYPE', 'POST requires application/json', 415);
        let bytes = 0; const chunks = [];
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 65_536) throw new ServiceError('BODY_TOO_LARGE', 'Request exceeds 64 KiB', 413); chunks.push(chunk); }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
          params = { ...params, ...body };
        } catch { throw new ServiceError('INVALID_JSON', 'Expected one JSON object', 400); }
      }
      if (Object.values(params).some(v => v !== null && !['string', 'number'].includes(typeof v))) throw new ServiceError('INVALID_PARAMETER', 'Parameters must be scalar strings or numbers', 400);
      const result = await (url.pathname === '/fx' ? miner.fx(params) : miner.macro(params));
      send(200, { ...result, local_content_sha256: responseDigest(result), duration_ms: Math.round((performance.now() - started) * 1000) / 1000 });
    } catch (error) {
      const failure = failureResponse(error); send(failure.status, failure.body);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`ReferenceForge local miner: http://${host}:${port} (not registered)`));
}
