import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Wallet, keccak256 } from 'ethers';
import { onchainDescriptor } from '../tools/render-onchain-miner.mjs';
import { CONFIG, ABI, argumentsFor, floorPrice, accountAddress, makePlan, refreshReviewed, sendOnce, verifyReceipt, readRecord, hiddenKey } from '../tools/register-miner.mjs';

// Public dummy fixture key. No test signer connects to any real network provider.
const wallet = new Wallet('0x' + '11'.repeat(32));
const artifact = Buffer.from(JSON.stringify(onchainDescriptor({ id: 1900999001, baseUrl: CONFIG.origin }), null, 2) + '\n');
const fetchImpl = async url => new Response(url.endsWith('/miner.yaml') ? artifact : JSON.stringify({ supported_intents: CONFIG.intents }));
const journal = () => resolve('reports/test-miner-registration', randomUUID() + '.json');
function provider(overrides = {}) {
  return {
    send: async () => '0x14a34', getCode: async () => '0x6000',
    call: async tx => tx.data.startsWith(ABI.getFunction('isCanonicalIntent').selector)
      ? ABI.encodeFunctionResult('isCanonicalIntent', [true]) : ABI.encodeFunctionResult('registerMiner', [12345n]),
    getTransactionCount: async () => 2, estimateGas: async () => 200000n,
    getFeeData: async () => ({ maxFeePerGas: 2000000n, maxPriorityFeePerGas: 1000000n }),
    getBalance: async () => 1000000000000000000n,
    broadcastTransaction: async () => { throw new Error('Explicit broadcast mock required'); }, ...overrides
  };
}
const planFor = (p, extra = {}) => makePlan(p, wallet.address, { fetchImpl, ...extra });
function receipt(plan, txHash, { status = 1, author = plan.account, entityType = 0 } = {}) {
  const event = ABI.encodeEventLog(ABI.getEvent('IntentRegistered'), [12345n, author, entityType, '0x' + '00'.repeat(32), plan.url, plan.hash]);
  return { hash: txHash, from: plan.account, to: plan.contract, status, blockNumber: 1234, logs: [{ address: plan.contract, ...event }] };
}
const send = (p, plan, file, extra = {}) => sendOnce({ provider: p, wallet, plan, journalFile: file, refresh: () => planFor(p), log: () => {}, ...extra });

test('miner command defaults to read-only and rejects keys, duplicate modes and bad prices', () => {
  assert.equal(argumentsFor([]).mode, '--check');
  for (const args of [['--send'], ['--private-key', wallet.privateKey], ['--check', '--interactive'], ['--account', 'a', '--account', 'b']]) assert.throws(() => argumentsFor(args));
  assert.throws(() => accountAddress(wallet.privateKey)); assert.throws(() => accountAddress('0x' + '00'.repeat(20)));
  for (const price of ['1e-2', '0.001', '-1', '0.0100001', 'NaN', '']) assert.throws(() => floorPrice(price));
  assert.equal(floorPrice('0.01'), 10000n); assert.equal(floorPrice('0.123456'), 123456n);
});
test('miner preflight pins bytes, both intents, fee recipient, floor and zero transfer value', async () => {
  const feeAddress = '0x2222222222222222222222222222222222222222';
  const plan = await planFor(provider(), { feeAddress, price: '0.02' });
  const decoded = ABI.decodeFunctionData('registerMiner', plan.transaction.data);
  assert.deepEqual([...decoded[4]], [...CONFIG.intents]); assert.equal(decoded[0], CONFIG.url); assert.equal(decoded[1], CONFIG.hash);
  assert.equal(decoded[2], feeAddress); assert.equal(decoded[3], 20000n); assert.equal(plan.transaction.value, 0n);
});
test('wrong network, altered bytes and wrong health fail before signing', async () => {
  await assert.rejects(planFor(provider({ send: async () => '0x1' })), /Wrong network/);
  await assert.rejects(planFor(provider(), { fetchImpl: async () => new Response('changed') }), /bytes changed/);
  await assert.rejects(planFor(provider(), { fetchImpl: async url => new Response(url.endsWith('/miner.yaml') ? artifact : '{"supported_intents":[]}') }), /health/);
});
test('both intents must be canonical and the exact registration must simulate', async () => {
  const normal = provider();
  await assert.rejects(planFor(provider({ call: async tx => {
    if (tx.data === ABI.encodeFunctionData('isCanonicalIntent', [CONFIG.intents[1]])) return ABI.encodeFunctionResult('isCanonicalIntent', [false]);
    return normal.call(tx);
  } })), /ONCHAIN_METRIC_VERIFY.*canonical/);
  await assert.rejects(planFor(provider({ call: async tx => {
    if (tx.data.startsWith(ABI.getFunction('registerMiner').selector)) throw new Error('reverted');
    return normal.call(tx);
  } })), /simulation failed/);
});
test('pending nonce, excessive fees and unfunded balance cannot produce a send', async () => {
  await assert.rejects(planFor(provider({ getTransactionCount: async (_, tag) => tag === 'pending' ? 3 : 2 })), /pending transaction/);
  await assert.rejects(planFor(provider({ getFeeData: async () => ({ maxFeePerGas: 1000000000000n, maxPriorityFeePerGas: 1n }) })), /gas exceeds/);
  const p = provider({ getBalance: async () => 0n }), plan = await planFor(p), file = journal();
  assert.equal(plan.funded, false); await assert.rejects(send(p, plan, file), /Insufficient/); assert.equal(await readRecord(file), null);
});
test('refreshed review refuses changed nonce, calldata, funding, cost and expired approvals', async () => {
  const plan = await planFor(provider());
  for (const [change, expected] of [
    [{ transaction: { ...plan.transaction, nonce: 3 } }, /nonce changed/], [{ transaction: { ...plan.transaction, data: '0x' } }, /details changed/],
    [{ funded: false }, /funding is insufficient/], [{ l2Cost: plan.approvedCost + 1n }, /gas exceeds/]
  ]) assert.throws(() => refreshReviewed(plan, { ...plan, ...change }), expected);
  assert.throws(() => refreshReviewed({ ...plan, checkedAt: new Date(Date.now() - 600001).toISOString() }, plan), /expired/);
  const file = journal(); await assert.rejects(send(provider(), plan, file, { refresh: async () => ({ ...plan, transaction: { ...plan.transaction, nonce: 3 } }) }), /changed/);
  assert.equal(await readRecord(file), null);
});
test('wrong private key and signed calldata tampering are blocked before journalling', async () => {
  const p = provider(), plan = await planFor(p), file = journal();
  await assert.rejects(send(p, plan, file, { wallet: new Wallet('0x' + '22'.repeat(32)) }), /Key does not belong/);
  for (const change of [{ to: wallet.address }, { data: '0x' }, { value: 1n }, { chainId: 1n }, { accessList: [{ address: wallet.address, storageKeys: [] }] }]) {
    const signer = { address: wallet.address, signTransaction: tx => wallet.signTransaction({ ...tx, ...change }) };
    await assert.rejects(send(p, plan, file, { wallet: signer }), /does not match/);
  }
  assert.equal(await readRecord(file), null);
});
test('single successful broadcast records its deterministic hash first and cannot repeat', async () => {
  const file = journal(), p = provider(), plan = await planFor(p); let broadcasts = 0, txHash;
  p.broadcastTransaction = async signed => {
    broadcasts++; const record = await readRecord(file); txHash = keccak256(signed);
    assert.equal(record.txHash, txHash); assert.equal(record.state, 'broadcast_uncertain');
    return { hash: txHash };
  };
  p.waitForTransaction = async () => receipt(plan, txHash);
  const result = await send(p, plan, file);
  assert.equal(result.state, 'confirmed'); assert.equal(result.registration.registrationId, '12345');
  assert.deepEqual(result.intents, [...CONFIG.intents]);
  const disk = await readFile(file, 'utf8'); assert.equal(disk.includes(wallet.privateKey), false); assert.equal(disk.includes('serialized'), false);
  await assert.rejects(send(p, plan, file), /prior attempt/); assert.equal(broadcasts, 1);
});
test('uncertain broadcast and reverted receipts preserve a permanent duplicate barrier', async () => {
  for (const reverted of [false, true]) {
    const file = journal(), p = provider(), plan = await planFor(p); let broadcasts = 0, txHash;
    p.broadcastTransaction = async signed => { broadcasts++; txHash = keccak256(signed); if (!reverted) throw new Error('response lost'); return { hash: txHash }; };
    p.waitForTransaction = async () => receipt(plan, txHash, { status: 0 });
    const result = await send(p, plan, file);
    assert.equal(result.state, reverted ? 'reverted' : 'broadcast_uncertain');
    await assert.rejects(send(p, plan, file), /prior attempt/); assert.equal(broadcasts, 1);
  }
});
test('existing exclusive lock or corrupt journal blocks new signing', async () => {
  const file = journal(), p = provider(), plan = await planFor(p); await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file + '.lock', ''); await assert.rejects(send(p, plan, file), /holds the lock/);
  const other = journal(); await writeFile(other, '{'); await assert.rejects(send(p, plan, other), /unreadable/);
});
test('WASM event, unrelated sender/hash/contract and failed receipt cannot claim miner confirmation', async () => {
  const plan = await planFor(provider()), txHash = '0x' + 'ab'.repeat(32), record = { ...plan, txHash };
  assert.equal(verifyReceipt(receipt(plan, txHash), record).registrationId, '12345');
  for (const r of [receipt(plan, txHash, { entityType: 2 }), receipt(plan, txHash, { author: '0x' + '22'.repeat(20) }), receipt(plan, txHash, { status: 0 }), receipt(plan, '0x' + '00'.repeat(32)), { ...receipt(plan, txHash), to: wallet.address }]) assert.equal(verifyReceipt(r, record), null);
});
test('miner key prompt hides input, restores raw mode, and handles cancellation', async () => {
  for (const cancel of [false, true]) {
    const input = new PassThrough(), output = new PassThrough(); let rendered = '';
    input.isTTY = true; output.isTTY = true; input.setRawMode = raw => { input.isRaw = raw; };
    output.on('data', b => { rendered += b; });
    const pending = hiddenKey(input, output); input.write(cancel ? '\u0003' : wallet.privateKey + '\r');
    if (cancel) await assert.rejects(pending, /cancelled/); else assert.equal(await pending, wallet.privateKey);
    assert.equal(rendered.includes(wallet.privateKey), false); assert.equal(input.isRaw, false);
  }
});
