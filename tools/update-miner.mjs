// User-run migration only. No key in command arguments; default mode is read-only.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Interface, JsonRpcProvider, Wallet, formatEther, formatUnits } from 'ethers';
import { CONFIG as BASE, RegistrationError, accountAddress, hiddenKey, sendOnce, readRecord, finishReceipt } from './register-miner.mjs';
import { unifiedDescriptor, UNIFIED_ORIGIN } from './render-unified-miner.mjs';

export const TARGET = Object.freeze({ ...BASE,
  owner: '0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3', oldId: 4838, retireId: 4843,
  origin: UNIFIED_ORIGIN, url: UNIFIED_ORIGIN + '/referenceforge-unified.yaml',
  hash: '0x6c1d031c2cc64ad6a57db83c8bb18af5538ef9531df2872b11267ead929d349a',
  oldUrl: UNIFIED_ORIGIN + '/miner.yaml', oldHash: '0x5a676c4d038e763647772510967de4b381b9e149ac1d93423ad68e8669b12752',
  retireUrl: BASE.url, retireHash: BASE.hash, intents: Object.freeze(unifiedDescriptor().semantics.supported_intents)
});
export const ABI = new Interface([
  'function getMiner(uint256) view returns(address owner,string yamlUrl,bytes32 yamlHash,bool active,bytes32 intentId,address feeAddress,uint256 minPriceUsdc,string[] supportedIntents)',
  'function updateMiner(uint256 registrationId,string yamlUrl,bytes32 yamlHash,address feeAddress,uint256 minPriceUsdc,string[] supportedIntents) returns(uint256)',
  'function deregisterMiner(uint256 registrationId)',
  'function isCanonicalIntent(string) view returns(bool)'
]);
const requireThat = (ok, message) => { if (!ok) throw new RegistrationError(message); };
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const sameList = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export async function readMiner(provider, id) {
  const r = ABI.decodeFunctionResult('getMiner', await provider.call({ to: TARGET.contract, data: ABI.encodeFunctionData('getMiner', [id]) }));
  return { id: Number(id), owner: r[0], url: r[1], hash: r[2], active: r[3], feeAddress: r[5], minPriceUsdc: r[6], intents: [...r[7]] };
}
async function boundedJson(url, fetchImpl) {
  const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  requireThat(r.ok && r.body, 'Required hosted artifact or node status is unavailable. Nothing will be signed.');
  const reader = r.body.getReader(), parts = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; requireThat(size <= 65536, 'Unexpected response size.'); parts.push(Buffer.from(value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(parts);
}
async function checkNetworkAndArtifact(provider, fetchImpl) {
  requireThat(BigInt(await provider.send('eth_chainId', [])) === TARGET.chainId, 'Wrong network. Only Base Sepolia (84532) is allowed.');
  requireThat((await provider.getCode(TARGET.contract)) !== '0x', 'Registry contract has no code.');
  const bytes = await boundedJson(TARGET.url, fetchImpl);
  requireThat('0x' + createHash('sha256').update(bytes).digest('hex') === TARGET.hash, 'Combined hosted YAML bytes changed. Nothing signed.');
  requireThat(JSON.stringify(JSON.parse(bytes.toString('utf8'))) === JSON.stringify(unifiedDescriptor()), 'Unexpected combined descriptor.');
  const health = JSON.parse((await boundedJson(TARGET.origin + '/health', fetchImpl)).toString('utf8'));
  requireThat(sameList(health.supported_intents ?? [], TARGET.intents), 'Combined runtime does not advertise all four intents.');
  for (const intent of TARGET.intents) {
    const r = await provider.call({ to: TARGET.contract, data: ABI.encodeFunctionData('isCanonicalIntent', [intent]) });
    requireThat(ABI.decodeFunctionResult('isCanonicalIntent', r)[0], intent + ' is not canonical.');
  }
}
function checkOld(miner, onchain = false) {
  requireThat(equal(miner.owner, TARGET.owner) && miner.active && miner.url === (onchain ? TARGET.retireUrl : TARGET.oldUrl)
    && equal(miner.hash, onchain ? TARGET.retireHash : TARGET.oldHash)
    && sameList(miner.intents, onchain ? TARGET.intents.slice(2) : TARGET.intents.slice(0, 2))
    && equal(miner.feeAddress, TARGET.owner) && miner.minPriceUsdc === 10000n,
  'Existing registration ' + miner.id + ' changed, is inactive, or belongs to another wallet. Stop and inspect; no new registration will be guessed.');
}
async function transactionPlan(provider, data, operation, previousRegistrationId) {
  const tx = { from: TARGET.owner, to: TARGET.contract, data, value: 0n };
  try { await provider.call(tx); } catch { throw new RegistrationError('Migration contract simulation failed. Nothing sent.'); }
  const latest = await provider.getTransactionCount(TARGET.owner, 'latest'), pending = await provider.getTransactionCount(TARGET.owner, 'pending');
  requireThat(latest === pending, 'Wallet has a pending transaction. Resolve it before continuing.');
  const estimate = await provider.estimateGas(tx), gasLimit = (estimate * 125n + 99n) / 100n, fees = await provider.getFeeData();
  requireThat(gasLimit > 0n && gasLimit <= 2000000n && fees.maxFeePerGas > 0n && fees.maxPriorityFeePerGas >= 0n && fees.maxPriorityFeePerGas <= fees.maxFeePerGas, 'Unexpected gas or fee estimate.');
  const l2Cost = gasLimit * fees.maxFeePerGas, balance = await provider.getBalance(TARGET.owner);
  requireThat(l2Cost <= TARGET.maxL2Cost, 'L2 fee ceiling exceeds 0.001 test ETH.');
  const approvedCost = l2Cost * 2n < TARGET.maxL2Cost ? l2Cost * 2n : TARGET.maxL2Cost;
  return { checkedAt: new Date().toISOString(), operation, previousRegistrationId, account: TARGET.owner, contract: TARGET.contract,
    chainId: TARGET.chainId, url: TARGET.url, hash: TARGET.hash, feeAddress: TARGET.owner, minPriceUsdc: 10000n, intents: [...TARGET.intents],
    transaction: { ...tx, chainId: TARGET.chainId, type: 2, nonce: pending, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas },
    balance, l2Cost, approvedCost, reserve: TARGET.reserve, funded: balance >= approvedCost + TARGET.reserve };
}
export async function makeUpdatePlan(provider, { fetchImpl = fetch } = {}) {
  await checkNetworkAndArtifact(provider, fetchImpl);
  checkOld(await readMiner(provider, TARGET.oldId)); checkOld(await readMiner(provider, TARGET.retireId), true);
  const data = ABI.encodeFunctionData('updateMiner', [TARGET.oldId, TARGET.url, TARGET.hash, TARGET.owner, 10000n, TARGET.intents]);
  return transactionPlan(provider, data, 'update_to_four_intents', TARGET.oldId);
}
export async function checkReplacement(provider, replacementId, { fetchImpl = fetch } = {}) {
  requireThat(/^\d+$/.test(String(replacementId)) && BigInt(replacementId) > 0n && ![TARGET.oldId, TARGET.retireId].includes(Number(replacementId)), 'A confirmed NEW replacement registration ID is required before retirement.');
  const miner = await readMiner(provider, replacementId), old = await readMiner(provider, TARGET.oldId);
  requireThat(miner.active && equal(miner.owner, TARGET.owner) && miner.url === TARGET.url && equal(miner.hash, TARGET.hash)
    && equal(miner.feeAddress, TARGET.owner) && miner.minPriceUsdc === 10000n && sameList(miner.intents, TARGET.intents) && !old.active,
  'Replacement is not active with the pinned four-intent configuration, or original registration is still active. Retirement blocked.');
  const node = JSON.parse((await boundedJson('https://devnode.telegraphprotocol.com/api/miners/' + replacementId, fetchImpl)).toString('utf8')).miner;
  requireThat(node && String(node.registration_id) === String(replacementId) && node.activation_status === 'active' && node.slug === 'referenceforge-numeric'
    && equal(node.miner_address, TARGET.owner) && node.yaml_url === TARGET.url && equal('0x' + node.yaml_hash.replace(/^0x/, ''), TARGET.hash)
    && equal(node.fee_address, TARGET.owner) && Number(node.min_price_usdc) === 10000 && sameList(node.supported_intents ?? [], TARGET.intents),
  'Telegraph has not activated the exact four-intent replacement. Keep the old Onchain miner active and retry status later.');
  return miner;
}
export async function makeRetirePlan(provider, replacementId, { fetchImpl = fetch } = {}) {
  await checkNetworkAndArtifact(provider, fetchImpl); await checkReplacement(provider, replacementId, { fetchImpl });
  checkOld(await readMiner(provider, TARGET.retireId), true);
  return transactionPlan(provider, ABI.encodeFunctionData('deregisterMiner', [TARGET.retireId]), 'retire_duplicate_onchain', TARGET.retireId);
}
export async function verifyRetirementReceipt(provider, receipt, record) {
  if (!receipt || Number(receipt.status) !== 1 || !equal(receipt.hash, record.txHash) || !equal(receipt.from, TARGET.owner) || !equal(receipt.to, TARGET.contract)) return null;
  const miner = await readMiner(provider, TARGET.retireId);
  return !miner.active && equal(miner.owner, TARGET.owner) && equal(miner.hash, TARGET.retireHash) ? { retiredRegistrationId: String(TARGET.retireId) } : null;
}
export function argumentsFor(args) {
  let mode;
  for (const arg of args) { requireThat(['--check', '--status', '--interactive'].includes(arg) && !mode, 'Choose --check, --status or --interactive. No private keys or addresses in arguments.'); mode = arg; }
  return mode ?? '--check';
}
async function confirmation(token, message) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(message + '\nType ' + token + ' to approve; anything else cancels: ') === token; }
  finally { prompt.close(); }
}
async function localWallet() {
  let key = (await hiddenKey()).trim();
  try {
    requireThat(/^(0x)?[a-fA-F0-9]{64}$/.test(key), 'Invalid private key format. Nothing signed.');
    const wallet = new Wallet(key.startsWith('0x') ? key : '0x' + key);
    requireThat(equal(wallet.address, TARGET.owner), 'Key does not match the displayed owner. Nothing sent.'); return wallet;
  } finally { key = ''; }
}
function printPlan(plan) {
  console.log(json({ operation: plan.operation, network: 'Base Sepolia (84532), TESTNET ONLY', owner: plan.account, existingRegistration: plan.previousRegistrationId,
    registry: plan.contract, yamlUrl: plan.url, yamlSHA256: plan.hash, intents: plan.intents, feeAddress: plan.feeAddress,
    floorPriceUSDC: formatUnits(plan.minPriceUsdc, 6), nonce: plan.transaction.nonce, balanceTestETH: formatEther(plan.balance),
    estimatedL2GasTestETH: formatEther(plan.l2Cost), approvedMaximumL2GasTestETH: formatEther(plan.approvedCost), additionalL1ReserveTestETH: formatEther(plan.reserve), funded: plan.funded,
    scope: plan.operation === 'update_to_four_intents' ? 'ONE updateMiner transaction replacing 4838 with a new registration for all four intents. 4843 stays active until a separate retirement approval.' : 'ONE deregisterMiner transaction for 4843 ONLY; the confirmed replacement stays active.',
    limits: 'Zero transfer value; testnet gas only. L1 reserve is not an exact fee quote. Hosted checks and simulation do not prove scoring or end-to-end node execution.' }));
}
async function refreshJournal(provider, file, verifier) {
  const record = await readRecord(file); if (!record) return null;
  requireThat(equal(record.account, TARGET.owner) && record.url === TARGET.url && equal(record.hash, TARGET.hash), 'Unexpected migration journal. Stop and inspect.');
  return finishReceipt(await provider.getTransactionReceipt(record.txHash), record, file, verifier);
}
async function main(args) {
  const mode = argumentsFor(args), interactive = mode === '--interactive';
  requireThat(!interactive || process.stdin.isTTY && process.stdout.isTTY, 'Interactive signing requires your own normal terminal.');
  accountAddress(TARGET.owner);
  const dir = resolve(import.meta.dirname, '../reports/unified-migration', TARGET.owner.toLowerCase() + '-' + TARGET.hash.slice(2));
  const updateFile = resolve(dir, 'update.json'), retireFile = resolve(dir, 'retire.json');
  const provider = new JsonRpcProvider(TARGET.rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 }); provider.pollingInterval = 3000;
  const retireVerifier = (receipt, record) => verifyRetirementReceipt(provider, receipt, record);
  try {
    requireThat(BigInt(await provider.send('eth_chainId', [])) === TARGET.chainId, 'Wrong network.');
    let updated = await refreshJournal(provider, updateFile), retired = await refreshJournal(provider, retireFile, retireVerifier), wallet;
    if (mode === '--status') {
      console.log(json({ update: updated, retirement: retired, currentOriginal: await readMiner(provider, TARGET.oldId), currentOldOnchain: await readMiner(provider, TARGET.retireId) }));
      if (updated?.registration?.registrationId) {
        try { const replacement = await checkReplacement(provider, updated.registration.registrationId); console.log(json({ replacement, nodeActiveForAllFour: true })); }
        catch (error) { console.log(error instanceof RegistrationError ? error.message : 'Replacement node check unavailable.'); }
      } return;
    }
    if (!updated) {
      const plan = await makeUpdatePlan(provider); printPlan(plan); if (!interactive) return;
      requireThat(plan.funded, 'Insufficient Base Sepolia test ETH. Nothing signed.');
      if (!await confirmation('UPDATE_REFERENCEFORGE', 'Approve updating miner 4838 to all FOUR intents, preserving the 0.01 USDC floor and fee recipient?')) return;
      wallet = await localWallet();
      updated = await sendOnce({ provider, wallet, plan, journalFile: updateFile, refresh: () => makeUpdatePlan(provider) });
      console.log(json({ update: updated }));
    }
    requireThat(updated.state === 'confirmed' && updated.registration?.registrationId, 'Update is pending, failed or uncertain. Hash is saved. Use --status; no second update will be sent.');
    const replacementId = updated.registration.registrationId;
    console.log('Replacement registration ID: ' + replacementId);
    if (retired) { console.log(json({ retirement: retired })); console.log('No second retirement will be sent. Use --status.'); return; }
    // Indexing can take time. Refuse retirement until exact on-chain AND node checks pass.
    let retirePlan;
    for (let attempt = 0; attempt < (interactive ? 6 : 1); attempt++) {
      try { retirePlan = await makeRetirePlan(provider, replacementId); break; }
      catch (error) {
        if (!interactive || attempt === 5) {
          console.log(error instanceof RegistrationError ? error.message : 'Retirement preflight unavailable.');
          console.log('No retirement sent. Keep 4843 active. Run --status, then rerun --interactive later; the journal prevents another update.'); return;
        }
        if (attempt === 0) console.log('Waiting briefly for Telegraph to activate the replacement. Old Onchain miner remains active.');
        await new Promise(resolveDelay => setTimeout(resolveDelay, 3000));
      }
    }
    printPlan(retirePlan); if (!interactive) return;
    requireThat(retirePlan.funded, 'Replacement is active, but more test ETH is needed for the retirement gas reserve. Nothing retired.');
    if (!await confirmation('RETIRE_ONCHAIN_4843', 'Replacement ' + replacementId + ' is active for all FOUR intents. Approve retiring the separate old Onchain registration 4843?')) return;
    wallet ??= await localWallet();
    retired = await sendOnce({ provider, wallet, plan: retirePlan, journalFile: retireFile, refresh: () => makeRetirePlan(provider, replacementId), receiptVerifier: retireVerifier });
    console.log(json({ replacementId, retirement: retired }));
    console.log('Check: node tools/update-miner.mjs --status');
    if (retired.state !== 'confirmed') process.exitCode = 2;
    else console.log('On-chain consolidation complete. Explorer catalogue removal of 4843 can lag; check node status. This is not scoring or rewards evidence.');
  } finally { provider.destroy(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof RegistrationError ? error.message : 'Migration stopped on an RPC or local operation error. Do not repeat a transaction. Use --status.'); process.exitCode = 1; }
}
