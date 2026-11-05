import { ServiceError } from '../errors.mjs';

async function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    // The caller may already have started an operation before checking the
    // signal. Observe a late rejection even when no wait is possible.
    Promise.resolve(promise).catch(() => {});
    throw new Error('deadline');
  }
  let abort;
  const stopped = new Promise((_, reject) => { abort = () => reject(new Error('deadline')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}
export async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function boundedText(response, limit, signal) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0; const parts = [];
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('deadline');
      const { done, value } = await abortable(reader.read(), signal); if (done) break;
      size += value.length;
      if (size > limit) throw new Error('response too large');
      parts.push(value);
    }
  } finally {
    // Underlying-source cancel hooks may themselves return a stalled promise.
    // Cleanup must not defeat the caller's deadline or the response-size bound.
    const cleanupDeadline=AbortSignal.timeout(100);
    const cleanupSignal=signal?AbortSignal.any([signal,cleanupDeadline]):cleanupDeadline;
    try { await abortable(reader.cancel(),cleanupSignal); } catch {}
    finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBalance', 'eth_getCode', 'eth_call']);
function pause(ms,signal) {
  if(signal.aborted)return Promise.reject(new Error('deadline'));
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('deadline'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
export function createRpcSession(network, { fetchImpl = fetch, signal, rpcTimeoutMs = 1800, onRpcError=()=>{} } = {}) {
  if (network.providers.length !== 2 || new Set(network.providers.map(x=>x.operator)).size !== 2 || new Set(network.providers.map(x=>new URL(x.url).host)).size !== 2) throw new Error('Configure two separately operated RPC endpoints');
  let requests = 0, methods = 0, rateLimitRetries=0;
  const evidence = network.providers.map(p => ({ operator: p.operator, batches: [] }));
  async function batch(index, calls) {
    if (!calls.length || calls.length > 5 || calls.some(x=>!METHODS.has(x.method))) throw new Error('Read-only RPC budget violation');
    const batchLimit=network.providers[index].maxBatchItems??5;
    if(!Number.isInteger(batchLimit)||batchLimit<1||batchLimit>5)throw new Error('Invalid configured RPC batch size');
    if(calls.length>batchLimit) {
      const result=[];
      for(let offset=0;offset<calls.length;offset+=batchLimit)result.push(...await batch(index,calls.slice(offset,offset+batchLimit)));
      return result;
    }
    const started = performance.now();
    let stage='request',httpStatus=null,rpcCode=null;
    try {
      const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(rpcTimeoutMs)]) : AbortSignal.timeout(rpcTimeoutMs);
      const body = calls.map((call, i) => ({ jsonrpc: '2.0', id: i + 1, method: call.method, params: call.params ?? [] }));
      let r,attempts=0;
      for(let attempt=0;attempt<2;attempt++) {
        if(++requests>16)throw new Error('RPC request budget exceeded');
        methods+=calls.length;attempts++;if(attempt)rateLimitRetries++;
        stage='request';httpStatus=null;
        r=await abortable(fetchImpl(network.providers[index].url,{method:'POST',headers:{...network.providers[index].headers,'content-type':'application/json'},redirect:'manual',body:JSON.stringify(body),signal:deadline}),deadline);
        httpStatus=r.status;
        if(r.status===429&&attempt===0) {
          const header=r.headers.get('retry-after');
          const delay=header===null?400:/^[0-9]+(?:\.[0-9]+)?$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now();
          await r.body?.cancel();
          // Respect long Retry-After instead of retrying earlier to meet a target.
          if(!Number.isFinite(delay)||delay<0||delay>1000||performance.now()-started+delay>=rpcTimeoutMs)throw new Error('Rate-limit wait exceeds the bounded request budget');
          stage='rate_backoff';await pause(delay,deadline);continue;
        }
        if(!r.ok)throw new Error('HTTP');
        break;
      }
      if(!r.ok)throw new Error('HTTP');
      stage='body';
      const text = await boundedText(r, 2_097_152, deadline), rows = JSON.parse(text);
      stage='batch_validation';rpcCode=typeof rows?.error?.code==='number'?rows.error.code:null;
      if (!Array.isArray(rows) || rows.length !== calls.length) throw new Error('batch shape');
      const found = new Map();
      for (const row of rows) {
        if(typeof row?.error?.code==='number')rpcCode=row.error.code;
        if (!row || row.jsonrpc !== '2.0' || !Number.isInteger(row.id) || row.id < 1 || row.id > calls.length || found.has(row.id) || Object.hasOwn(row, 'error') || !Object.hasOwn(row, 'result')) throw new Error('RPC result');
        found.set(row.id, row.result);
      }
      evidence[index].batches.push({ methods: calls.map(x=>x.method),attempts, response_sha256: await digest(text), duration_ms: Math.round((performance.now()-started)*1000)/1000 });
      return calls.map((_, i)=>found.get(i+1));
    } catch {
      try{onRpcError({operator:network.providers[index].operator,stage,http_status:httpStatus,rpc_code:rpcCode,duration_ms:Math.round(performance.now()-started)});}catch{}
      // Do not leak provider URLs, credentials or raw library/request errors.
      throw new ServiceError('RPC_UNAVAILABLE', 'One of the two independent RPC sources failed, timed out, exceeded bounds or returned an invalid response. No single-source fallback.', 503);
    }
  }
  return { batch, both: async calls => {
    const results=await Promise.allSettled([batch(0,calls),batch(1,calls)]);
    const failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;
    return results.map(x=>x.value);
  }, evidence, stats: () => ({ http_requests: requests, rpc_methods: methods,rate_limit_retries:rateLimitRetries }) };
}
