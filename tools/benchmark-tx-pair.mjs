// Freeze public Base evidence before calling either comparison target.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NETWORKS} from '../src/onchain/input.mjs';
import {boundedText} from '../src/onchain/rpc.mjs';
import {assessTxAnswer, referenceOutcome, TX_INTENT} from './lib/provider-tx-acceptance.mjs';
import {parseTxCapture} from './lib/tx-node-receipt.mjs';

const sources = NETWORKS.base.providers;
const providerUrl = 'https://referenceforge.0xsaroj001.workers.dev/v2/tx';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [mode, path, extra] = process.argv.slice(2);
assert(!extra && (mode === '--freeze' ? !path : ['--run', '--replay'].includes(mode) && path),
  'Use --freeze, --run <frozen.json>, or --replay <comparison.json>');

async function save(path, data) {
  const bytes = JSON.stringify(data, null, 2) + '\n';
  await writeFile(path, bytes, {flag:'wx'});
  await writeFile(path + '.sha256', sha(bytes) + '\n', {flag:'wx'});
  return sha(bytes);
}

async function load(path) {
  const bytes = await readFile(path);
  const digest = sha(bytes);
  assert.equal(digest, (await readFile(path + '.sha256', 'utf8')).trim(), 'Evidence bytes changed');
  return {data:JSON.parse(bytes), digest};
}

async function read(url, request, records) {
  const signal = AbortSignal.timeout(12000);
  const record = {url, request};
  const start = performance.now();
  records.push(record);
  try {
    const response = await fetch(url, {signal, redirect:'error', ...(request && {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(request)
    })});
    record.status = response.status;
    record.text = await boundedText(response, 2097152, signal);
    if (request) return {status:response.status, body:JSON.parse(record.text)};
    try { return {status:response.status, body:parseTxCapture(record.text)}; }
    catch (error) { return {status:response.status, body:null, failure:error.message}; }
  } catch (error) {
    record.failure = error.message;
    throw error;
  } finally {
    record.elapsed_ms = Math.round(performance.now() - start);
  }
}

async function rpc(source, method, params, records) {
  const {status, body} = await read(source.url, {jsonrpc:'2.0', id:1, method, params}, records);
  assert(status === 200 && body?.id === 1 && body.jsonrpc === '2.0' && !Object.hasOwn(body, 'error') && Object.hasOwn(body, 'result'),
    `${source.operator} did not fulfill ${method} (HTTP ${status})`);
  return body.result;
}

async function freeze() {
  const records = [], cases = [];
  const selection = 'Use two consecutive Base blocks at observed head minus 64 and 65. Take the first nonzero empty-calldata and first zero-value nonempty-calldata standard transaction in each block. Preserve empty slots and do not replace them.';
  const baseline = 'Two parallel RPC methods on the official public Base endpoint. Use the transaction fields and receipt execution status, with zero transferred on revert. No second source or canonical block check.';
  try {
    const head = BigInt(await rpc(sources[0], 'eth_blockNumber', [], records));
    const chainIds = await Promise.allSettled(sources.map(source => rpc(source, 'eth_chainId', [], records)));
    assert(chainIds.every(row => row.status === 'fulfilled' && BigInt(row.value) === 8453n), 'Reference chain check failed');
    for (const depth of [64n, 65n]) {
      const height = '0x' + (head - depth).toString(16);
      const block = await rpc(sources[0], 'eth_getBlockByNumber', [height, true], records);
      const witness = await rpc(sources[1], 'eth_getBlockByNumber', [height, false], records);
      for (const kind of ['native_payment', 'zero_value_contract_call']) {
        const tx = block.transactions.find(tx => {
          if (!tx.to || !['0x0','0x1','0x2','0x3','0x4'].includes(tx.type)) return false;
          return kind === 'native_payment' ? tx.input === '0x' && BigInt(tx.value) > 0n : tx.input !== '0x' && BigInt(tx.value) === 0n;
        });
        if (!tx) {
          cases.push({height, kind, excluded:'empty_selection_slot'});
          continue;
        }
        const input = {chain:'base', txHash:tx.hash};
        const references = [];
        for (const [index, source] of sources.entries()) {
          const capture = {
            chainId:chainIds[index].value,
            transaction:await rpc(source, 'eth_getTransactionByHash', [tx.hash], records),
            receipt:await rpc(source, 'eth_getTransactionReceipt', [tx.hash], records),
            block:index ? witness : {...block, transactions:block.transactions.map(tx => tx.hash)}
          };
          references.push({operator:source.operator, capture});
        }
        const facts = references.map(row => referenceOutcome(row.capture, input));
        assert.deepEqual(facts[0], facts[1], 'Reference operators disagree');
        cases.push({height, kind, input, references, expected:facts[0]});
      }
    }
    const absentHash = '0x' + sha('referenceforge-tx-benchmark-absent:' + head);
    const absentReads = await Promise.allSettled(sources.map(source => rpc(source, 'eth_getTransactionByHash', [absentHash], records)));
    const absentInput = {chain:'base', txHash:absentHash};
    if (absentReads.every(row => row.status === 'fulfilled' && row.value === null)) {
      cases.push({kind:'observed_absent', input:absentInput, expectedCode:'UNSCORED_TRANSACTION_STATE'});
    } else {
      cases.push({kind:'observed_absent', input:absentInput, excluded:'absence_unconfirmed_by_two_sources'});
    }
    cases.push({kind:'malformed_hash', input:{chain:'base', txHash:'invalid'}, expectedCode:'INVALID_HASH'});
    cases.push({kind:'unsupported_chain', input:{chain:'ethereum', txHash:absentHash}, expectedCode:'UNSUPPORTED_CHAIN'});
    return {frozen_at:new Date().toISOString(), selection, baseline, head:String(head), cases, records, failure:null};
  } catch (error) {
    return {frozen_at:new Date().toISOString(), selection, baseline, cases, records, failure:error.message};
  }
}

async function plainRpc(input, records) {
  const refusal = code => ({status:422, body:{error:{code}}});
  if (input.chain !== 'base') return refusal('UNSUPPORTED_CHAIN');
  if (!/^0x[0-9a-f]{64}$/i.test(input.txHash)) return refusal('INVALID_HASH');
  const results = await Promise.allSettled(['eth_getTransactionByHash','eth_getTransactionReceipt']
    .map(method => rpc(sources[0], method, [input.txHash], records)));
  if (results.some(row => row.status === 'rejected')) throw new Error('Baseline RPC read failed');
  const [tx, receipt] = results.map(row => row.value);
  if (!tx || !receipt) return refusal('UNSCORED_TRANSACTION_STATE');
  assert(['0x0','0x1'].includes(receipt.status), 'Unsupported baseline receipt status');
  const confirmed = receipt.status === '0x1';
  const digits = BigInt(tx.value).toString().padStart(19, '0');
  const value = Number(digits.slice(0, -18) + '.' + digits.slice(-18));
  return {status:200, body:{provider_status:'ok', intent:TX_INTENT, request_schema_version:1, response_format_version:1,
    tx_hash:tx.hash, status:confirmed ? 'confirmed' : 'reverted', from:tx.from, to:tx.to,
    block_number:Number(BigInt(tx.blockNumber)), value_eth:confirmed ? value : 0}};
}

async function measure(action) {
  const records = [], start = performance.now();
  let response;
  try { response = await action(records); }
  catch (error) { response = {status:null, failure:error.message}; }
  return {response, records, elapsed_ms:Math.round(performance.now() - start)};
}

function assess(entry, measurement, checkedAt) {
  const {status, body} = measurement.response;
  if (status === null || status === 429 || status >= 500) return 'unavailable';
  if (entry.expectedCode) {
    if (status === 422 && body?.error?.code === entry.expectedCode &&
        ['tx_hash','block_number','value_eth'].every(field => !Object.hasOwn(body, field))) return 'correct_refusal';
    return 'incorrect';
  }
  if (status !== 200) return 'refused_mined_case';
  return assessTxAnswer({...entry, checked_at:checkedAt, provider:measurement.response}).pass ? 'correct_answer' : 'incorrect';
}

function summarize(plan, results) {
  const cases = plan.cases.filter(entry => !entry.excluded);
  assert.equal(cases.length, results.rows.length, 'Incomplete comparison');
  return cases.map((entry, index) => {
    const {provider, baseline} = results.rows[index];
    return {kind:entry.kind, expected:entry.expected?.status ?? entry.expectedCode,
      provider:assess(entry, provider, results.checked_at), provider_ms:provider.elapsed_ms,
      provider_rpc:provider.response.body?.evidence?.verification?.rpc_cost ?? null,
      provider_error:provider.response.body?.error?.code ?? provider.response.failure ?? null,
      baseline:assess(entry, baseline, results.checked_at), baseline_ms:baseline.elapsed_ms,
      baseline_rpc_calls:baseline.records.length};
  });
}

const file = path && resolve(path);
if (mode === '--freeze') {
  const directory = resolve(import.meta.dirname, '../reports/tx-pair-benchmark', randomUUID());
  await mkdir(directory, {recursive:true});
  const frozenPath = resolve(directory, 'frozen.json');
  const plan = await freeze();
  plan.runner_sha256 = sha(await readFile(import.meta.filename));
  const digest = await save(frozenPath, plan);
  console.log(JSON.stringify({frozenPath, digest, cases:plan.cases.length, failure:plan.failure}, null, 2));
  if (plan.failure) process.exitCode = 1;
} else {
  const frozenPath = mode === '--run' ? file : resolve(file, '../frozen.json');
  const {data:plan, digest} = await load(frozenPath);
  assert(!plan.failure && plan.cases.some(entry => entry.expected), 'Usable frozen source evidence required');
  assert.equal(plan.runner_sha256, sha(await readFile(import.meta.filename)), 'Benchmark code changed after freeze');
  const resultPath = mode === '--run' ? resolve(frozenPath, '../comparison.json') : file;
  let results;
  if (mode === '--run') {
    await writeFile(resolve(frozenPath, '../attempt.json'), JSON.stringify({started_at:new Date().toISOString(), frozen_sha256:digest}), {flag:'wx'});
    results = {checked_at:new Date().toISOString(), frozen_sha256:digest, rows:[]};
    for (const entry of plan.cases.filter(entry => !entry.excluded)) {
      const url = new URL(providerUrl);
      url.search = new URLSearchParams({chain:entry.input.chain, tx_hash:entry.input.txHash});
      const runProvider = () => measure(records => read(url.href, null, records));
      const runBaseline = () => measure(records => plainRpc(entry.input, records));
      let provider, baseline;
      if (results.rows.length % 2 === 0) { provider = await runProvider(); baseline = await runBaseline(); }
      else { baseline = await runBaseline(); provider = await runProvider(); }
      results.rows.push({provider, baseline});
    }
    await save(resultPath, results);
  } else {
    ({data:results} = await load(resultPath));
    assert.equal(results.frozen_sha256, digest, 'Comparison belongs to a different freeze');
  }
  console.log(JSON.stringify({resultPath, frozen_sha256:digest, exclusions:plan.cases.filter(entry => entry.excluded).map(({kind, excluded}) => ({kind, excluded})),
    rows:summarize(plan, results)}, null, 2));
}
