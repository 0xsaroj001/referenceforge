import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Wallet, keccak256 } from 'ethers';
import { TARGET, ABI, argumentsFor, makeUpdatePlan, makeRetirePlan, checkReplacement, verifyRetirementReceipt } from '../tools/update-miner.mjs';
import { ABI as REGISTER_ABI, sendOnce, readRecord } from '../tools/register-miner.mjs';
import { unifiedDescriptor } from '../tools/render-unified-miner.mjs';
const replacementId = 5000;
function setup({ replaced = false, nodeStatus = 'active', nodeChange = {}, oldChange = {}, replacementChange = {}, otherChange = {}, noncanonical, wrongNetwork = false } = {}) {
  const miners = new Map([
    [4838, { owner: TARGET.owner, url: TARGET.oldUrl, hash: TARGET.oldHash, active: !replaced, feeAddress: TARGET.owner, price: 10000n, intents: TARGET.intents.slice(0, 2), ...oldChange }],
    [4843, { owner: TARGET.owner, url: TARGET.retireUrl, hash: TARGET.retireHash, active: true, feeAddress: TARGET.owner, price: 10000n, intents: TARGET.intents.slice(2), ...otherChange }],
    [replacementId, { owner: TARGET.owner, url: TARGET.url, hash: TARGET.hash, active: true, feeAddress: TARGET.owner, price: 10000n, intents: TARGET.intents, ...replacementChange }]
  ]);
  const node = { registration_id: replacementId, activation_status: nodeStatus, slug: 'referenceforge-numeric', miner_address: TARGET.owner,
    yaml_url: TARGET.url, yaml_hash: TARGET.hash.slice(2), fee_address: TARGET.owner, min_price_usdc: 10000, supported_intents: TARGET.intents, ...nodeChange };
  let broadcasts = 0;
  const provider = {
    send: async () => wrongNetwork ? '0x1' : '0x14a34', getCode: async () => '0x6000',
    call: async tx => {
      if (tx.data.startsWith(ABI.getFunction('getMiner').selector)) {
        const id = Number(ABI.decodeFunctionData('getMiner', tx.data)[0]), m = miners.get(id);
        return ABI.encodeFunctionResult('getMiner', [m.owner, m.url, m.hash, m.active, '0x' + '00'.repeat(32), m.feeAddress, m.price, m.intents]);
      }
      if (tx.data.startsWith(ABI.getFunction('isCanonicalIntent').selector)) {
        const intent = ABI.decodeFunctionData('isCanonicalIntent', tx.data)[0]; return ABI.encodeFunctionResult('isCanonicalIntent', [intent !== noncanonical]);
      }
      return tx.data.startsWith(ABI.getFunction('updateMiner').selector) ? ABI.encodeFunctionResult('updateMiner', [replacementId]) : '0x';
    },
    getTransactionCount: async () => 4, estimateGas: async () => 300000n,
    getFeeData: async () => ({ maxFeePerGas: 2000000n, maxPriorityFeePerGas: 1000000n }), getBalance: async () => 1000000000000000000n,
    broadcastTransaction: async () => { broadcasts++; throw new Error('No fixture broadcast unless explicitly overridden'); }
  };
  const fetchImpl = async url => new Response(url === TARGET.url ? JSON.stringify(unifiedDescriptor(), null, 2) + '\n'
    : url.endsWith('/health') ? JSON.stringify({ supported_intents: TARGET.intents }) : JSON.stringify({ miner: node }));
  return { provider, fetchImpl, miners, broadcasts: () => broadcasts };
}
test('migration modes default to read-only and never accept a key argument', () => {
  assert.equal(argumentsFor([]), '--check'); assert.equal(argumentsFor(['--status']), '--status');
  for (const args of [['--interactive', '--check'], ['--private-key'], ['--account'], ['--send']]) assert.throws(() => argumentsFor(args));
});
test('update pins existing ID, all four intents, new artifact and unchanged fee terms', async () => {
  const f = setup(), plan = await makeUpdatePlan(f.provider, f), decoded = ABI.decodeFunctionData('updateMiner', plan.transaction.data);
  assert.equal(decoded[0], 4838n); assert.equal(decoded[1], TARGET.url); assert.equal(decoded[2], TARGET.hash);
  assert.equal(decoded[3], TARGET.owner); assert.equal(decoded[4], 10000n); assert.deepEqual([...decoded[5]], [...TARGET.intents]);
  assert.equal(plan.transaction.value, 0n); assert.equal(plan.operation, 'update_to_four_intents'); assert.equal(f.broadcasts(), 0);
});
test('wrong chain, changed original owner/artifact, fee terms or other miner blocks update', async () => {
  for (const options of [{ wrongNetwork: true }, { oldChange: { owner: '0x' + '11'.repeat(20) } }, { oldChange: { hash: '0x' + '11'.repeat(32) } },
    { oldChange: { active: false } }, { oldChange: { price: 20000n } }, { otherChange: { hash: '0x' + '22'.repeat(32) } }, { noncanonical: 'ONCHAIN_METRIC_VERIFY' }]) {
    const f = setup(options); await assert.rejects(makeUpdatePlan(f.provider, f)); assert.equal(f.broadcasts(), 0);
  }
  const f = setup(); await assert.rejects(makeUpdatePlan(f.provider, { fetchImpl: async () => new Response('altered') }), /bytes changed/);
});
test('successful node activation is required before retirement and both chain/node metadata must match', async () => {
  for (const options of [
    { replaced: false }, { replaced: true, nodeStatus: 'pending' }, { replaced: true, nodeStatus: 'rejected' },
    { replaced: true, nodeChange: { yaml_hash: '00'.repeat(32) } }, { replaced: true, nodeChange: { supported_intents: TARGET.intents.slice(0, 3) } },
    { replaced: true, nodeChange: { miner_address: '0x' + '11'.repeat(20) } }, { replaced: true, replacementChange: { active: false } },
    { replaced: true, replacementChange: { intents: TARGET.intents.slice(0, 3) } }
  ]) {
    const f = setup(options); await assert.rejects(makeRetirePlan(f.provider, replacementId, f)); assert.equal(f.broadcasts(), 0);
  }
  const f = setup({ replaced: true });
  await assert.rejects(checkReplacement(f.provider, 4838, f), /NEW replacement/);
  await assert.rejects(checkReplacement(f.provider, 4843, f), /NEW replacement/);
  const plan = await makeRetirePlan(f.provider, replacementId, f), decoded = ABI.decodeFunctionData('deregisterMiner', plan.transaction.data);
  assert.equal(decoded[0], 4843n); assert.equal(plan.previousRegistrationId, 4843); assert.equal(plan.operation, 'retire_duplicate_onchain');
});
test('retirement receipt checks the exact transaction and inactive old registration', async () => {
  const f = setup({ replaced: true }), txHash = '0x' + 'ab'.repeat(32), record = { txHash };
  const receipt = { hash: txHash, status: 1, from: TARGET.owner, to: TARGET.contract };
  assert.equal(await verifyRetirementReceipt(f.provider, receipt, record), null);
  f.miners.get(4843).active = false;
  assert.deepEqual(await verifyRetirementReceipt(f.provider, receipt, record), { retiredRegistrationId: '4843' });
  for (const change of [{ status: 0 }, { hash: '0x' + '00'.repeat(32) }, { to: TARGET.owner }, { from: '0x' + '11'.repeat(20) }]) assert.equal(await verifyRetirementReceipt(f.provider, { ...receipt, ...change }, record), null);
});
// Public dummy key and mock provider ONLY. Does not use the real owner's signer.
test('migration signing primitive journals before one update and blocks an ambiguous repeat', async () => {
  const f = setup(), realPlan = await makeUpdatePlan(f.provider, f), wallet = new Wallet('0x' + '11'.repeat(32));
  const plan = { ...realPlan, account: wallet.address, transaction: { ...realPlan.transaction, from: wallet.address } };
  const file = resolve('reports/test-unified-migration', randomUUID() + '.json'); let count = 0;
  const p = { broadcastTransaction: async signed => { count++; assert.equal((await readRecord(file)).txHash, keccak256(signed)); throw new Error('lost response'); } };
  const args = { provider: p, wallet, plan, journalFile: file, refresh: async () => plan, log: () => {} };
  const record = await sendOnce(args); assert.equal(record.state, 'broadcast_uncertain'); assert.equal(record.operation, 'update_to_four_intents');
  await assert.rejects(sendOnce(args), /prior attempt/); assert.equal(count, 1);
});
test('update receipt establishes a NEW miner ID; retirement uses its own verifier', async () => {
  const f = setup(), original = await makeUpdatePlan(f.provider, f), wallet = new Wallet('0x' + '11'.repeat(32));
  const plan = { ...original, account: wallet.address, transaction: { ...original.transaction, from: wallet.address } };
  const file = resolve('reports/test-unified-migration', randomUUID() + '.json'); let txHash;
  const p = { broadcastTransaction: async signed => { txHash = keccak256(signed); }, waitForTransaction: async () => {
    const event = REGISTER_ABI.encodeEventLog(REGISTER_ABI.getEvent('IntentRegistered'), [replacementId, wallet.address, 0, '0x' + '00'.repeat(32), TARGET.url, TARGET.hash]);
    return { hash: txHash, status: 1, from: wallet.address, to: TARGET.contract, blockNumber: 50, logs: [{ address: TARGET.contract, ...event }] };
  } };
  const result = await sendOnce({ provider: p, wallet, plan, journalFile: file, refresh: async () => plan, log: () => {} });
  assert.equal(result.state, 'confirmed'); assert.equal(result.registration.registrationId, '5000'); assert.equal(result.previousRegistrationId, 4838);
});
