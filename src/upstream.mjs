import { createHash } from 'node:crypto';
import { ServiceError } from './errors.mjs';

export function createSources({ fetchImpl = fetch, now = () => new Date(), timeoutMs = 8000, maxCacheEntries = 128, maxAttempts = 2, retryDelayMs = 125, onError = () => {}, cache = new Map() } = {}) {
  // An isolate may share resolved text/cache metadata, never request-owned promises.
  const pending = new Map();
  const counts = { attempts: 0, retries: 0, cache_hits: 0, coalesced: 0, loads: 0, failures: 0, invalid_payloads: 0 };
  let active = 0;
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
          if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
          cache.set(url, { expires: now().getTime() + ttlMs, value });
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
