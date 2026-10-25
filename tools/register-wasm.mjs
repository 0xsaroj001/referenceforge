// User-run signer. --check and --status never read a key or broadcast.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { Interface, JsonRpcProvider, Wallet, Transaction, getAddress, keccak256, formatEther, parseEther } from 'ethers';

export const CONFIG = Object.freeze({
  chainId: 84532n, rpc: 'https://sepolia.base.org',
  contract: getAddress('0x5a2324aa18613fad4e44bdf0d6c73ec1f6d87ff8'),
  url: 'https://referenceforge.0xsaroj001.workers.dev/referenceforge-comparator.wasm',
  hash: '0xc6943a7d9d0af1d20a76dc88020bbd6a78b0fc687e681e58912080053c73e2a7',
  sha256: 'c82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507',
  intent: 'FX_NOW', maxL2Cost: parseEther('0.001'), reserve: parseEther('0.00005')
});
export const ABI = new Interface([
  'function registerWasm(bytes32 wasmHash,string wasmUrl,string intent,address feeAddress) returns(uint256 registrationId)',
  'function getCanonicalIntentsWithDescriptions() view returns(string[] intents,string[] descriptions)',
  'function getWasm(uint256 registrationId) view returns(address author,bytes32 intentId,bytes32 wasmHash,string wasmUrl,string intent,bool active,uint256 bondAmount)',
  'event IntentRegistered(uint256 indexed registrationId,address indexed registrant,uint8 entityType,bytes32 intentId,string contentUrl,bytes32 contentHash)'
]);
export class RegistrationError extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new RegistrationError(message); };
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export function accountAddress(value) {
  requireThat(/^0x[0-9a-fA-F]{40}$/.test(value ?? ''), 'Supply --account with your public wallet address, not a key.');
  return getAddress(value.toLowerCase());
}

export async function makePlan(provider, account, { config = CONFIG, fetchImpl = fetch } = {}) {
  account = accountAddress(account);
  requireThat(BigInt(await provider.send('eth_chainId', [])) === config.chainId, 'Wrong network. Only Base Sepolia chain 84532 is allowed.');
  requireThat((await provider.getCode(config.contract)) !== '0x', 'Registry contract has no code on this network.');
  const response = await fetchImpl(config.url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  requireThat(response.ok, 'The hosted WASM is unavailable. Nothing will be signed.');
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; requireThat(size <= 100000, 'Unexpected WASM size.'); parts.push(Buffer.from(value)); } }
  finally { await reader.cancel(); }
  const bytes = Buffer.concat(parts);
  requireThat(keccak256(bytes) === config.hash && createHash('sha256').update(bytes).digest('hex') === config.sha256, 'Hosted WASM bytes changed. Nothing will be signed.');
  const canonical = await provider.call({ to: config.contract, data: ABI.encodeFunctionData('getCanonicalIntentsWithDescriptions') });
  requireThat(ABI.decodeFunctionResult('getCanonicalIntentsWithDescriptions', canonical)[0].includes(config.intent), 'FX_NOW is not in the on-chain canonical list.');
  const transaction = { to: config.contract, from: account, value: 0n, data: ABI.encodeFunctionData('registerWasm', [config.hash, config.url, config.intent, account]) };
  try { await provider.call(transaction); }
  catch { throw new RegistrationError('Registration simulation failed. A duplicate active binary or another contract restriction may apply. No transaction sent.'); }
  const latest = await provider.getTransactionCount(account, 'latest'), pending = await provider.getTransactionCount(account, 'pending');
  requireThat(latest === pending, 'This wallet already has a pending transaction. Resolve it before making another.');
  const estimate = await provider.estimateGas(transaction), gasLimit = (estimate * 125n + 99n) / 100n;
  const fee = await provider.getFeeData();
  requireThat(fee.maxFeePerGas !== null && fee.maxPriorityFeePerGas !== null, 'RPC did not supply EIP-1559 fee estimates.');
  requireThat(gasLimit <= 2000000n, 'Unexpected gas requirement. Nothing will be signed.');
  const l2Cost = gasLimit * fee.maxFeePerGas, balance = await provider.getBalance(account);
  requireThat(l2Cost <= config.maxL2Cost, 'L2 gas ceiling exceeds 0.001 test ETH. Nothing will be signed.');
  const approvedCost = l2Cost * 2n < config.maxL2Cost ? l2Cost * 2n : config.maxL2Cost;
  const plan = { checkedAt: new Date().toISOString(), chainId: config.chainId, account, contract: config.contract, intent: config.intent, url: config.url, hash: config.hash,
    transaction: { ...transaction, chainId: config.chainId, type: 2, nonce: pending, gasLimit, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas },
    balance, l2Cost, approvedCost, reserve: config.reserve, funded: balance >= approvedCost + config.reserve };
  return plan;
}

export async function atomicRecord(file, value) {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  const handle = await open(temporary, 'w', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}
export async function readRecord(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new RegistrationError('Local transaction record is unreadable. Stop and inspect it before any new attempt.'); }
}
export function verifyReceipt(receipt, plan) {
  if (!receipt || Number(receipt.status) !== 1) return null;
  for (const log of receipt.logs ?? []) {
    if (!sameAddress(log.address, plan.contract)) continue;
    let event; try { event = ABI.parseLog(log); } catch { continue; }
    if (event?.name === 'IntentRegistered' && sameAddress(event.args.registrant, plan.account) && event.args.contentUrl === plan.url && event.args.contentHash.toLowerCase() === plan.hash.toLowerCase()) {
      return { registrationId: event.args.registrationId.toString(), entityType: event.args.entityType.toString() };
    }
  }
  return null;
}
export function validateSignedTransaction(signed, plan) {
  const tx = Transaction.from(signed), expected = plan.transaction;
  requireThat(sameAddress(tx.from, plan.account) && sameAddress(tx.to, expected.to) && tx.data === expected.data && tx.value === 0n && tx.chainId === BigInt(expected.chainId) && tx.nonce === expected.nonce && tx.gasLimit === BigInt(expected.gasLimit) && tx.maxFeePerGas === BigInt(expected.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(expected.maxPriorityFeePerGas), 'Signed transaction does not match the reviewed registration. Not broadcasting.');
  return tx.hash;
}

// Single broadcast only. Persist the deterministic hash BEFORE calling the RPC.
// A prior journal, even an ambiguous failure, blocks every later send attempt.
export async function sendOnce({ provider, wallet, plan, journalFile, log = console.log }) {
  requireThat(!(await readRecord(journalFile)), 'A prior attempt is recorded. Use -Status; do not submit again.');
  requireThat(sameAddress(wallet.address, plan.account), 'The key does not belong to the public wallet address supplied. Nothing sent.');
  requireThat(plan.funded, 'Insufficient Base Sepolia test ETH for gas and the L1-fee reserve. Nothing sent.');
  const signed = await wallet.signTransaction(plan.transaction), txHash = validateSignedTransaction(signed, plan);
  const record = { state: 'broadcast_uncertain', txHash, createdAt: new Date().toISOString(), account: plan.account, contract: plan.contract, url: plan.url, hash: plan.hash, intent: plan.intent };
  await atomicRecord(journalFile, record);
  log('Transaction hash: ' + txHash);
  log('https://sepolia.basescan.org/tx/' + txHash);
  try { await provider.broadcastTransaction(signed); }
  catch {
    log('RPC did not acknowledge the broadcast. The hash is saved. Use -Status; this helper will NOT send a replacement.');
    return record;
  }
  record.state = 'pending'; await atomicRecord(journalFile, record);
  log('Waiting up to two minutes for a receipt. Do not start a second registration.');
  let receipt; try { receipt = await provider.waitForTransaction(txHash, 1, 120000); } catch { return record; }
  return finishReceipt(receipt, record, journalFile);
}
async function finishReceipt(receipt, record, file) {
  if (!receipt) return record;
  const registration = verifyReceipt(receipt, record);
  const next = { ...record, state: Number(receipt.status) === 0 ? 'reverted' : registration ? 'confirmed' : 'mined_event_unverified', blockNumber: receipt.blockNumber, registration };
  await atomicRecord(file, next);
  return next;
}
function printPlan(plan) {
  console.log(json({ network: 'Base Sepolia (84532), testnet only', account: plan.account, registry: plan.contract, intent: plan.intent, wasmUrl: plan.url, keccak256: plan.hash,
    balanceTestETH: formatEther(plan.balance), estimatedL2GasCeilingTestETH: formatEther(plan.l2Cost), approvedMaximumL2GasTestETH: formatEther(plan.approvedCost), additionalL1FeeReserveTestETH: formatEther(plan.reserve), funded: plan.funded, nonce: plan.transaction.nonce,
    scope: 'One WASM registration. Does not register, update or deregister miner 4838. Does not prove node admission.', compatibility: '30 documented overflow-domain refusals remain.' }));
}
async function printStatus(provider, file) {
  const previous = await readRecord(file);
  if (!previous) { console.log('No transaction has been sent by this helper.'); return; }
  const receipt = await provider.getTransactionReceipt(previous.txHash);
  const record = await finishReceipt(receipt, previous, file);
  console.log(json(record));
  if (record.registration?.registrationId) {
    const url = 'https://devnode.telegraphprotocol.com/engine/validator/v1/wasm/' + record.registration.registrationId;
    try { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); console.log('Node status HTTP ' + r.status + ': ' + url); if (r.ok) console.log(JSON.stringify(await r.json(), null, 2)); }
    catch { console.log('Node status unavailable. On-chain confirmation is separate from activation.'); }
  }
}
export async function hiddenKey(input = process.stdin, output = process.stdout) {
  requireThat(input.isTTY && output.isTTY, 'Use a normal terminal for the hidden key prompt, or use the PowerShell wrapper.');
  emitKeypressEvents(input);
  const wasRaw = !!input.isRaw;
  output.write('Private key (hidden; never a seed phrase): ');
  input.setRawMode(true); input.resume();
  try {
    return await new Promise((resolveKey, rejectKey) => {
      let value = '', tooLong = false;
      const finish = (error) => { input.off('keypress', onKey); input.off('end', onEnd); error ? rejectKey(error) : resolveKey(value); };
      const onEnd = () => finish(new RegistrationError('Key entry cancelled. No transaction sent.'));
      const onKey = (text, key) => {
        if (key?.ctrl && key.name === 'c' || key?.name === 'escape') return onEnd();
        if (key?.name === 'return' || key?.name === 'enter') return finish(tooLong ? new RegistrationError('Key input too long. No transaction sent.') : null);
        if (key?.name === 'backspace') { value = value.slice(0, -1); return; }
        if (key?.ctrl || key?.meta || !text || /[\u0000-\u001f\u007f]/.test(text)) return;
        if (value.length + text.length > 100) { tooLong = true; return; }
        value += text;
      };
      input.on('keypress', onKey); input.once('end', onEnd);
    });
  } finally { input.setRawMode(wasRaw); input.pause(); output.write('\n'); }
}
function argumentsFor(args) {
  const modes = args.filter(x => ['--check', '--status', '--send', '--interactive'].includes(x));
  requireThat(modes.length <= 1, 'Choose only one of --check, --status, --send or --interactive.');
  const values = {}; for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--check', '--status', '--send', '--interactive', '--key-stdin'].includes(arg)) { values[arg] = true; continue; }
    requireThat(['--account', '--confirm'].includes(arg) && args[i + 1], 'Unknown or incomplete command option. Never put a private key in command arguments.');
    values[arg] = args[++i];
  }
  return { ...values, mode: modes[0] ?? '--check', account: accountAddress(values['--account']) };
}
async function main(args) {
  const options = argumentsFor(args), directory = resolve(import.meta.dirname, '../reports/wasm-terminal-registration');
  const file = resolve(directory, options.account.toLowerCase() + '-' + CONFIG.hash.slice(2, 18) + '.json');
  const reviewFile = file + '.review.json', lockFile = file + '.lock';
  const provider = new JsonRpcProvider(CONFIG.rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 }); provider.pollingInterval = 3000;
  let lock;
  try {
    if (options.mode === '--status') { await printStatus(provider, file); return; }
    if (await readRecord(file)) { await printStatus(provider, file); console.log('A previous attempt exists; no new transaction will be sent.'); process.exitCode = 10; return; }
    const plan = await makePlan(provider, options.account); printPlan(plan);
    if (options.mode === '--check') {
      requireThat(plan.funded, 'Insufficient Base Sepolia test ETH for gas. Get testnet ETH before continuing; do not buy real ETH for this helper.');
      await atomicRecord(reviewFile, { checkedAt: plan.checkedAt, nonce: plan.transaction.nonce, approvedCost: plan.approvedCost }); return;
    }
    const interactive = options.mode === '--interactive';
    requireThat(interactive || options['--key-stdin'] && options['--confirm'] === 'REGISTER_FX_NOW', 'Use --interactive or the PowerShell wrapper for a hidden key prompt and explicit confirmation.');
    requireThat(plan.funded, 'Insufficient Base Sepolia test ETH for gas. Nothing will be signed.');
    const reviewed = interactive ? { checkedAt: plan.checkedAt, nonce: plan.transaction.nonce, approvedCost: plan.approvedCost } : await readRecord(reviewFile);
    if (interactive) {
      requireThat(process.stdin.isTTY && process.stdout.isTTY, 'Interactive signing requires your normal terminal. No key read and nothing sent.');
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      let confirmation;
      try { confirmation = await prompt.question('Type REGISTER_FX_NOW to approve ONE WASM registration and the displayed gas ceiling; anything else cancels: '); }
      finally { prompt.close(); }
      if (confirmation !== 'REGISTER_FX_NOW') { console.log('Cancelled. No key read and nothing sent.'); return; }
    }
    await mkdir(directory, { recursive: true });
    try { lock = await open(lockFile, 'wx'); } catch { throw new RegistrationError('Another run or an interrupted attempt holds the local lock. Use -Status and inspect before retrying.'); }
    requireThat(!(await readRecord(file)), 'A prior transaction attempt is recorded. Use -Status.');
    let key = '';
    if (interactive) key = await hiddenKey();
    else for await (const chunk of process.stdin) { key += chunk; requireThat(key.length <= 100, 'Invalid key input. Nothing sent.'); }
    key = key.trim(); requireThat(/^(0x)?[0-9a-fA-F]{64}$/.test(key), 'Invalid private key format. Nothing sent.');
    let wallet; try { wallet = new Wallet(key.startsWith('0x') ? key : '0x' + key); } catch { throw new RegistrationError('Invalid private key. Nothing sent.'); } finally { key = ''; }
    requireThat(sameAddress(wallet.address, plan.account), 'The key does not match --account. Nothing sent.');
    const currentPlan = await makePlan(provider, options.account);
    const age = reviewed ? Date.now() - Date.parse(reviewed.checkedAt) : Infinity;
    requireThat(reviewed && age >= 0 && age < 600000 && reviewed.nonce === currentPlan.transaction.nonce && currentPlan.l2Cost <= BigInt(reviewed.approvedCost), 'The reviewed nonce or gas ceiling changed, or the check expired. Run again to review fresh details.');
    const result = await sendOnce({ provider, wallet, plan: currentPlan, journalFile: file });
    console.log(json({ state: result.state, txHash: result.txHash, registration: result.registration ?? null }));
    if (result.state !== 'confirmed') { console.log('Use the wrapper with -Status. Do not resubmit.'); process.exitCode = 2; }
  } finally { provider.destroy(); if (lock) { await lock.close(); await unlink(lockFile); } }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    // Never print a library error object: it may contain signer input or a signed payload.
    console.error(error instanceof RegistrationError ? error.message : 'Registration helper stopped on an RPC or local operation error. No automatic retry. Check -Status before trying again.');
    process.exitCode = 1;
  }
}
