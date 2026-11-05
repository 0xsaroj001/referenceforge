import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedText, createRpcSession } from '../src/onchain/rpc.mjs';
import { NETWORKS, networksForEnv } from '../src/onchain/input.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { fixture, A, NOW } from './fixtures/onchain.mjs';

const calls = [{ method: 'eth_chainId' }, { method: 'eth_getBlockByNumber', params: ['latest', false] }];
const rows = options => JSON.parse(options.body).map(({ id }) => ({ jsonrpc: '2.0', id, result: id === 1 ? '0x14a34' : null }));
function session(fetchImpl, extra = {}) { return createRpcSession(NETWORKS['base-sepolia'], { fetchImpl, ...extra }); }
async function keepAlive(run) { const timer = setTimeout(() => {}, 1000); try { return await run(); } finally { clearTimeout(timer); } }

test('anonymous source pair is official Base and Allnodes; account override preserves the second operator', () => {
  for (const [name, network] of Object.entries(NETWORKS)) {
    assert.equal(network.providers[0].operator, 'Base official public RPC');
    assert.equal(network.providers[0].url, name === 'base' ? 'https://mainnet.base.org' : 'https://sepolia.base.org');
    assert.equal(network.providers[1].operator, 'Allnodes PublicNode');
    assert.notEqual(new URL(network.providers[0].url).host, new URL(network.providers[1].url).host);
  }
  const configured = networksForEnv({ ALCHEMY_API_KEY: 'synthetic_test_key_123456' });
  assert.equal(configured.base.providers[0].operator, 'Alchemy account RPC'); assert.deepEqual(configured.base.providers[1], NETWORKS.base.providers[1]);
  assert.deepEqual(networksForEnv({}), NETWORKS);
});
test('out-of-order valid batches preserve request order and legitimate null results', async () => {
  const rpc = session(async (_url, options) => Response.json(rows(options).reverse()));
  assert.deepEqual(await rpc.both(calls), [['0x14a34', null], ['0x14a34', null]]);
  assert.equal(rpc.stats().http_requests, 2); assert(rpc.evidence.every(s => /^[a-f0-9]{64}$/.test(s.batches[0].response_sha256)));
});
test('HTTP 200 JSON-RPC code27 is a source failure, never a balance or single-source answer', async () => {
  const observed = [], f = fixture({ mutate: ({ method, result, index }) => result, transport: ({ rows, index }) => Response.json(index === 0 ? rows.map(row => ({ jsonrpc: '2.0', id: row.id, error: { code: 27, message: 'Unknown state. First available state is 1' } })) : rows) });
  const miner = createOnchainMiner({ fetchImpl: f.fetchImpl, now: () => NOW, onRpcError: e => observed.push(e) });
  await assert.rejects(miner.wallet({ chain: 'base-sepolia', address: A }), { code: 'RPC_UNAVAILABLE' });
  assert.equal(observed[0].http_status, 200); assert.equal(observed[0].rpc_code, 27); assert.equal(observed[0].stage, 'batch_validation');
  assert(!JSON.stringify(observed).includes('Unknown state')); assert(!JSON.stringify(observed).includes('https://'));
});
test('reproduced failure occurs specifically on hash-pinned state and preserves EIP1898 semantics', async () => {
  const f = fixture(), original = f.fetchImpl; let pinned = false;
  const fetchImpl = async (url, options) => {
    const input = JSON.parse(options.body), balance = input.find(c => c.method === 'eth_getBalance');
    if (balance) { pinned = true; assert.equal(balance.params[1].requireCanonical, true); assert.match(balance.params[1].blockHash, /^0x[a-f0-9]{64}$/); }
    if (url === f.network.providers[0].url && balance) return Response.json(input.map(c => ({ jsonrpc: '2.0', id: c.id, error: { code: 27, message: 'Unknown state. First available state is 1' } })));
    return original(url, options);
  };
  await assert.rejects(createOnchainMiner({ fetchImpl, now: () => NOW }).wallet({ chain: 'base-sepolia', address: A }), { code: 'RPC_UNAVAILABLE' });
  assert.equal(pinned, true);
});
test('malformed success and error envelopes cannot enter RPC evidence', async () => {
  const variants = [
    () => ({ jsonrpc: '2.0', id: null, error: { code: 27 } }),
    r => r.slice(0, 1), r => [r[0], r[0]], r => r.map(x => ({ ...x, id: String(x.id) })),
    r => r.map(x => ({ ...x, id: 99 })), r => r.map(x => ({ ...x, jsonrpc: '1.0' })),
    r => r.map(({ result, ...x }) => x), r => r.map(x => ({ ...x, error: null })),
    r => r.map(x => ({ ...x, error: { code: -32000, message: 'secret diagnostic' } }))
  ];
  for (const change of variants) {
    const rpc = session(async (_url, options) => Response.json(change(rows(options))));
    await assert.rejects(rpc.both(calls), { code: 'RPC_UNAVAILABLE' }); assert(rpc.evidence.every(e => e.batches.length === 0));
  }
});
test('invalid JSON, invalid UTF8, oversized responses and HTTP errors fail safely', async () => {
  for (const response of [() => new Response('{'), () => new Response(new Uint8Array([255])), () => new Response('x'.repeat(2_097_153)), () => new Response('secret upstream', { status: 403 }), () => new Response('redirect', { status: 302, headers: { location: 'https://untrusted.test' } })]) {
    const rpc = session(async () => response());
    await assert.rejects(rpc.both(calls), e => e.code === 'RPC_UNAVAILABLE' && !e.message.includes('secret'));
    assert(rpc.evidence.every(e => e.batches.length === 0));
  }
});
test('timeout bounds both a noncooperating fetch and a stalled streamed body', async () => keepAlive(async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const started = performance.now(), rpc = session(fetchImpl, { rpcTimeoutMs: 30 });
    await assert.rejects(rpc.both(calls), { code: 'RPC_UNAVAILABLE' }); assert(performance.now() - started < 500);
  }
}));
test('caller cancellation interrupts a stalled body and releases the reader', async () => keepAlive(async () => {
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const pending = boundedText(response, 10, controller.signal); controller.abort();
  await assert.rejects(pending); assert.equal(cancelled, true);
}));

test('a stalled cancel hook cannot extend the caller deadline or retain the reader lock', async () => keepAlive(async () => {
  let cancelled=false;const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}}));
  const started=performance.now(),result=await Promise.race([
    boundedText(response,10,AbortSignal.timeout(25)).then(()=> 'unexpected_success',()=> 'refused'),
    new Promise(resolve=>setTimeout(()=>resolve('still_pending'),300))
  ]);
  assert.equal(result,'refused');assert.equal(cancelled,true);assert.equal(response.body.locked,false);assert(performance.now()-started<300);
}));

test('size-limit refusal bounds a stalled cleanup even without a caller signal', async () => keepAlive(async () => {
  let cancelled=false;const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(12));},cancel(){cancelled=true;return new Promise(()=>{});}}));
  const result=await Promise.race([boundedText(response,10).then(()=> 'unexpected_success',error=>error.message),new Promise(resolve=>setTimeout(()=>resolve('still_pending'),350))]);
  assert.equal(result,'response too large');assert.equal(cancelled,true);assert.equal(response.body.locked,false);
}));

test('a cancel hook rejection cannot mask source decode failure or create an unhandled rejection after abort', async () => keepAlive(async () => {
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(0xff));controller.close();},cancel(){return Promise.reject(new Error('cleanup failure'));}}));
  await assert.rejects(boundedText(response,10),TypeError);assert.equal(response.body.locked,false);
  const controller=new AbortController(),aborted=new Response(new ReadableStream({cancel(){return Promise.reject(new Error('late cleanup failure'));}}));controller.abort();
  await assert.rejects(boundedText(aborted,10,controller.signal),/deadline/);assert.equal(aborted.body.locked,false);await new Promise(resolve=>setImmediate(resolve));
}));
test('batch and total request limits stop before additional network work', async () => {
  let count = 0; const rpc = session(async (_url, options) => { count++; return Response.json(rows(options)); });
  for (let i = 0; i < 8; i++) await rpc.both([{ method: 'eth_chainId' }]);
  await assert.rejects(rpc.both([{ method: 'eth_chainId' }]), { code: 'RPC_UNAVAILABLE' }); assert.equal(count, 16);
  for (const forbidden of [[], Array.from({ length: 6 }, () => ({ method: 'eth_chainId' })), [{ method: 'eth_sendRawTransaction', params: ['0x1234'] }]]) await assert.rejects(rpc.both(forbidden), /Read-only RPC budget violation/);
  assert.equal(count, 16);
});
test('one source timing out never returns the other operator result', async () => keepAlive(async () => {
  const rpc = session(async (url, options) => url === NETWORKS['base-sepolia'].providers[0].url ? new Promise(() => {}) : Response.json(rows(options)), { rpcTimeoutMs: 30 });
  await assert.rejects(rpc.both(calls), { code: 'RPC_UNAVAILABLE' }); assert.equal(rpc.evidence[0].batches.length, 0); assert.equal(rpc.evidence[1].batches.length, 1);
}));
test('configured labels and hosts must describe two different operators', () => {
  const p = NETWORKS.base.providers;
  for (const providers of [[p[0]], [p[0], p[0]], [p[0], { ...p[1], operator: p[0].operator }], [p[0], { ...p[1], url: p[0].url }]]) assert.throws(() => createRpcSession({ providers }), /two separately operated/);
});
