import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Wallet, keccak256 } from 'ethers';
import { CONFIG, ABI, makePlan, sendOnce, readRecord, hiddenKey, verifyReceipt } from '../tools/register-wasm.mjs';

// Public dummy test key; no fixture ever connects a signer to a real provider.
const wallet = new Wallet('0x' + '11'.repeat(32));
const artifact = Buffer.from('0061736d01000000', 'hex');
const config = { ...CONFIG, hash: keccak256(artifact), sha256: createHash('sha256').update(artifact).digest('hex') };
const fetchImpl = async () => new Response(artifact);
const journal = () => resolve('reports/test-wasm-registration', randomUUID() + '.json');
function provider(overrides = {}) {
  return {
    send: async () => '0x14a34', getCode: async () => '0x6000',
    call: async tx => tx.data === ABI.encodeFunctionData('getCanonicalIntentsWithDescriptions') ? ABI.encodeFunctionResult('getCanonicalIntentsWithDescriptions', [['FX_NOW'], ['fixture']]) : ABI.encodeFunctionResult('registerWasm', [9999n]),
    getTransactionCount: async () => 2, estimateGas: async () => 200000n,
    getFeeData: async () => ({ maxFeePerGas: 2000000n, maxPriorityFeePerGas: 1000000n }),
    getBalance: async () => 1000000000000000000n,
    broadcastTransaction: async () => { throw new Error('Broadcast stub must be supplied explicitly'); }, ...overrides
  };
}
const planFor = p => makePlan(p, wallet.address, { config, fetchImpl });
function receipt(plan, status = 1, author = plan.account) {
  const event = ABI.encodeEventLog(ABI.getEvent('IntentRegistered'), [9999n, author, 2, '0x' + '00'.repeat(32), plan.url, plan.hash]);
  return { status, blockNumber: 1234, logs: [{ address: plan.contract, ...event }] };
}

test('registration preflight refuses wrong network and altered hosted bytes', async () => {
  await assert.rejects(planFor(provider({ send: async () => '0x1' })), /Wrong network/);
  await assert.rejects(makePlan(provider(), wallet.address, { config, fetchImpl: async () => new Response('changed') }), /bytes changed/);
});
test('preflight requires a canonical intent and successful contract simulation', async () => {
  await assert.rejects(planFor(provider({ call: async () => ABI.encodeFunctionResult('getCanonicalIntentsWithDescriptions', [[], []]) })), /canonical list/);
  const normal = provider();
  await assert.rejects(planFor(provider({ call: async tx => {
    if (tx.data === ABI.encodeFunctionData('getCanonicalIntentsWithDescriptions')) return normal.call(tx);
    throw new Error('duplicate wasm hash');
  } })), /simulation failed/);
});
test('preflight distinguishes funding failure and refuses pending nonces', async () => {
  const unfunded = await planFor(provider({ getBalance: async () => 0n }));
  assert.equal(unfunded.funded, false);
  await assert.rejects(sendOnce({ provider: provider(), wallet, plan: unfunded, journalFile: journal(), log: () => {} }), /Insufficient/);
  await assert.rejects(planFor(provider({ getTransactionCount: async (_, tag) => tag === 'pending' ? 3 : 2 })), /pending transaction/);
});
test('a different private-key wallet cannot sign for the reviewed account', async () => {
  const p = provider(), plan = await planFor(p), file = journal();
  await assert.rejects(sendOnce({ provider: p, wallet: new Wallet('0x' + '22'.repeat(32)), plan, journalFile: file, log: () => {} }), /does not belong/);
  assert.equal(await readRecord(file), null);
});
test('signed destination tampering is refused before a journal or broadcast', async () => {
  const p = provider(), plan = await planFor(p), file = journal();
  const tamperedSigner = { address: wallet.address, signTransaction: tx => wallet.signTransaction({ ...tx, to: '0x0000000000000000000000000000000000000001' }) };
  await assert.rejects(sendOnce({ provider: p, wallet: tamperedSigner, plan, journalFile: file, log: () => {} }), /does not match/);
  assert.equal(await readRecord(file), null);
});
test('successful run journals the exact hash before one broadcast and refuses a duplicate run', async () => {
  const file = journal(), p = provider(), plan = await planFor(p), logs = []; let broadcasts = 0;
  p.broadcastTransaction = async signed => {
    broadcasts++;
    const before = await readRecord(file);
    assert.equal(before.state, 'broadcast_uncertain');
    assert.equal(before.txHash, keccak256(signed));
    return { hash: before.txHash };
  };
  p.waitForTransaction = async () => receipt(plan);
  const result = await sendOnce({ provider: p, wallet, plan, journalFile: file, log: line => logs.push(line) });
  assert.equal(result.state, 'confirmed'); assert.equal(result.registration.registrationId, '9999');
  const disk = await readFile(file, 'utf8');
  assert.equal(disk.includes(wallet.privateKey), false);
  assert.equal(logs.join('\n').includes(wallet.privateKey), false);
  await assert.rejects(sendOnce({ provider: p, wallet, plan, journalFile: file, log: () => {} }), /prior attempt/);
  assert.equal(broadcasts, 1);
});
test('ambiguous RPC failure keeps its hash and never automatically sends again', async () => {
  const file = journal(), p = provider(), plan = await planFor(p); let broadcasts = 0;
  p.broadcastTransaction = async () => { broadcasts++; throw new Error('response lost after submission'); };
  const result = await sendOnce({ provider: p, wallet, plan, journalFile: file, log: () => {} });
  assert.equal(result.state, 'broadcast_uncertain'); assert.match(result.txHash, /^0x[0-9a-f]{64}$/);
  await assert.rejects(sendOnce({ provider: p, wallet, plan, journalFile: file, log: () => {} }), /prior attempt/);
  assert.equal(broadcasts, 1);
});
test('a mined receipt without our matching event cannot claim a registration ID', async () => {
  const p = provider(), plan = await planFor(p);
  assert.equal(verifyReceipt(receipt(plan, 0), plan), null);
  assert.equal(verifyReceipt(receipt(plan, 1, '0x0000000000000000000000000000000000000001'), plan), null);
  p.broadcastTransaction = async () => ({}); p.waitForTransaction = async () => receipt(plan, 0);
  const result = await sendOnce({ provider: p, wallet, plan, journalFile: journal(), log: () => {} });
  assert.equal(result.state, 'reverted'); assert.equal(result.registration, null);
});
test('hidden terminal input emits no key characters and restores terminal mode', async () => {
  const input = new PassThrough(), output = new PassThrough(); let rendered = '';
  input.isTTY = true; output.isTTY = true;
  input.setRawMode = raw => { input.isRaw = raw; };
  output.on('data', value => { rendered += value.toString(); });
  const pending = hiddenKey(input, output), fakeKey = '0x' + 'ab'.repeat(32);
  input.write(fakeKey + '\r');
  assert.equal(await pending, fakeKey);
  assert.equal(rendered.includes(fakeKey), false); assert.equal(rendered.includes('abab'), false); assert.equal(input.isRaw, false);
});
test('Ctrl+C during hidden key entry cancels and restores terminal mode', async () => {
  const input = new PassThrough(), output = new PassThrough(); input.isTTY = true; output.isTTY = true;
  input.setRawMode = raw => { input.isRaw = raw; };
  const pending = hiddenKey(input, output); input.write('\u0003');
  await assert.rejects(pending, /cancelled/); assert.equal(input.isRaw, false);
});
