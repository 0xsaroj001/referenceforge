import { createHash } from 'node:crypto';
import { ServiceError } from './errors.mjs';

export function createSources({ fetchImpl = fetch, now = () => new Date(), timeoutMs = 8000, maxCacheEntries = 128, maxAttempts = 2, retryDelayMs = 125, onError = () => {}, cache = new Map(), cacheApi } = {}) {
  // An isolate may share resolved text/cache metadata, never request-owned promises.
  const pending = new Map();
  const counts = { attempts: 0, retries: 0, cache_hits: 0, persistent_cache_hits:0, coalesced: 0, loads: 0, failures: 0, invalid_payloads: 0 };
  let active = 0;
  const digest=text=>createHash('sha256').update(text).digest('hex');
  const remember=(url,entry)=>{if(cache.size>=maxCacheEntries&&!cache.has(url))cache.delete(cache.keys().next().value);cache.set(url,entry);};
  async function boundedCacheText(response){
    if(!response.body)throw new Error('missing cache body');const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1100000)throw new Error('oversized cache body');chunks.push(Buffer.from(value));}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');
  }
  return {
    stats() { return { ...counts, active, cached_entries: cache.size }; },
    async get(url, ttlMs, { validate } = {}) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['www.ecb.europa.eu', 'api.worldbank.org'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) {
        throw new ServiceError('SOURCE_NOT_ALLOWED', 'Only configured official upstream hosts are allowed', 500);
      }
      const validatePayload = async text => {
        if (!validate) return;
        try { await validate(text); } catch (error) { counts.invalid_payloads++; throw error; }
      };
      // Cache only resolved source text, not request-owned I/O or final answers.
      const persistentKey=cacheApi?new Request('https://referenceforge.0xsaroj001.workers.dev/__numeric-source-cache/v1?source='+encodeURIComponent(url)):null;
      const existing = cache.get(url);
      if (existing && existing.expires > now().getTime()) {
        try { await validatePayload(existing.value.text); counts.cache_hits++; return { ...existing.value, cache_hit: true }; }
        catch { if (cache.get(url) === existing) cache.delete(url); } // Do not evict a newer concurrent refresh.
      }
      if (pending.has(url)) {
        counts.coalesced++; const value = await pending.get(url);
        try { await validatePayload(value.text); } catch (error) { if (cache.get(url)?.value === value) cache.delete(url); throw error; }
        return value;
      }
      if (active >= 4) throw new ServiceError('BUSY', 'Upstream concurrency limit reached; retry later', 503);
      const load = (async () => {
        active++; counts.loads++;
        try {
          if(cacheApi&&ttlMs>0){
            try{
              const r=await cacheApi.match(persistentKey);
              if(r?.ok){
                const entry=JSON.parse(await boundedCacheText(r)),v=entry?.value,t=now().getTime(),fetched=Date.parse(v?.fetched_at);
                if(Number.isFinite(entry?.expires)&&entry.expires>t&&entry.expires<=t+ttlMs&&Number.isFinite(fetched)&&fetched<=t&&entry.expires<=fetched+ttlMs&&v.source_url===url&&typeof v.text==='string'&&Buffer.byteLength(v.text)<=1000000&&digest(v.text)===v.payload_sha256){
                  await validatePayload(v.text);remember(url,entry);counts.cache_hits++;counts.persistent_cache_hits++;return {...v,cache_hit:true};
                }
              }
            }catch{} // A cache failure or invalid entry must not hide the source path.
          }
          const deadline = performance.now() + timeoutMs;
          let response, lastError;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const remaining = Math.floor(deadline - performance.now());
            if (remaining <= 0) break;
            counts.attempts++; if (attempt) counts.retries++;
            try {
              response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.max(1, Math.floor(remaining / (maxAttempts - attempt)))), redirect: 'manual', headers: { 'User-Agent': 'ReferenceForge/0.2 source-backed research miner' } });
              if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new ServiceError('SOURCE_REDIRECT', 'Official source redirected; refusing an unverified destination', 503); }
              if (response.ok) break;
              lastError = new ServiceError('SOURCE_HTTP_ERROR', `Official source returned HTTP ${response.status}`, 503);
              if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
              const retryAfter = response.headers.get('retry-after');
              const delay = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now().getTime()) : retryDelayMs;
              await response.body?.cancel(); response = null;
              if (attempt + 1 === maxAttempts || !Number.isFinite(delay) || delay > deadline - performance.now() - 1) throw lastError;
              await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
            } catch (error) {
              if (error instanceof ServiceError) throw error;
              lastError = error; response = null;
              if (attempt + 1 < maxAttempts && deadline - performance.now() > retryDelayMs) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
          }
          if (!response?.ok) throw lastError ?? new ServiceError('SOURCE_UNAVAILABLE', 'Official source deadline exceeded', 503);
          if (Number(response.headers.get('content-length') ?? 0) > 1_000_000) throw new ServiceError('SOURCE_TOO_LARGE', 'Official source response exceeds the size limit', 503);
          const reader = response.body.getReader(); const chunks = []; let size = 0;
          try {
            for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_000_000) { await reader.cancel(); throw new ServiceError('SOURCE_TOO_LARGE', 'Official source response exceeds the size limit', 503); } chunks.push(Buffer.from(value)); }
          } finally { reader.releaseLock(); }
          const bytes = Buffer.concat(chunks);
          const value = { text: bytes.toString('utf8'), source_url: url, fetched_at: now().toISOString(), payload_sha256: createHash('sha256').update(bytes).digest('hex'), cache_hit: false };
          await validatePayload(value.text);
          const upstream=/\bmax-age=(\d+)/i.exec(response.headers.get('cache-control')??''),age=Number(response.headers.get('age')??0);
          const seconds=!/\b(?:no-store|private|no-cache)\b/i.test(response.headers.get('cache-control')??'')&&Number.isFinite(age)&&age>=0?Math.max(0,Math.min(ttlMs/1000,upstream?Number(upstream[1])-age:Infinity)):0;
          const entry={expires:Date.parse(value.fetched_at)+seconds*1000,value};
          if(seconds>0)remember(url,entry);
          if(cacheApi&&seconds>=1)try{const serialized=JSON.stringify(entry);if(Buffer.byteLength(serialized)<=1100000)await cacheApi.put(persistentKey,new Response(serialized,{headers:{'content-type':'application/json','cache-control':'public, max-age='+Math.floor(seconds)}}));}catch{}
          return value;
        } catch (error) {
          counts.failures++;
          onError(error);
          if (error instanceof ServiceError) throw error;
          throw new ServiceError('SOURCE_UNAVAILABLE', 'Could not read the official source within its limits', 503);
        } finally { active--; }
      })();
      pending.set(url, load);
      try { return await load; } finally { pending.delete(url); }
    }
  };
}
