// User-run only. Default/check/status modes never request a key or broadcast.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { Interface, JsonRpcProvider, Wallet, Transaction, getAddress, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';

export const CONFIG = Object.freeze({
  chainId: 84532n, rpc: 'https://sepolia.base.org',
  contract: getAddress('0x5a2324aa18613fad4e44bdf0d6c73ec1f6d87ff8'),
  origin: 'https://referenceforge-onchain.0xsaroj001.workers.dev',
  url: 'https://referenceforge-onchain.0xsaroj001.workers.dev/miner.yaml',
  hash: '0x0249b5ce39199dcc0df449ebc57048aee6be798eed9b2e548db2621e1d5ba17d',
  intents: Object.freeze(['CRYPTO_TRANSFER_VERIFY', 'ONCHAIN_METRIC_VERIFY']),
  maxL2Cost: parseEther('0.001'), reserve: parseEther('0.00005')
});
export const ABI = new Interface([
  'function registerMiner(string yamlUrl,bytes32 yamlHash,address feeAddress,uint256 minPriceUsdc,string[] supportedIntents) returns(uint256)',
  'function isCanonicalIntent(string intent) view returns(bool)',
  'event IntentRegistered(uint256 indexed registrationId,address indexed registrant,uint8 entityType,bytes32 intentId,string contentUrl,bytes32 contentHash)'
]);
export class RegistrationError extends Error {}
const requireThat = (ok, message) => { if (!ok) throw new RegistrationError(message); };
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export function accountAddress(value) {
  requireThat(/^0x[0-9a-fA-F]{40}$/.test(value ?? '') && !/^0x0{40}$/i.test(value), 'Enter a nonzero public wallet address, not a private key.');
  return getAddress(value.toLowerCase());
}
export function floorPrice(value) {
  requireThat(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/.test(value ?? ''), 'Floor price must be decimal USDC with at most six decimal places.');
  const price = parseUnits(value, 6);
  requireThat(price >= 10000n, 'The documented minimum floor price is 0.01 USDC (10000 units).');
  return price;
}
async function boundedFetch(url, fetchImpl, limit = 65536) {
  const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  requireThat(r.ok && r.body, 'Hosted miner artifact or health endpoint unavailable. Nothing will be signed.');
  const reader = r.body.getReader(), parts = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; requireThat(size <= limit, 'Unexpected hosted response size. Nothing will be signed.');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}
export async function makePlan(provider, account, { feeAddress = account, price = '0.01', fetchImpl = fetch } = {}) {
  account = accountAddress(account); feeAddress = accountAddress(feeAddress);
  const minPriceUsdc = floorPrice(price);
  requireThat(BigInt(await provider.send('eth_chainId', [])) === CONFIG.chainId, 'Wrong network. Only Base Sepolia (84532) is allowed.');
  requireThat((await provider.getCode(CONFIG.contract)) !== '0x', 'Registry has no contract code.');
  const bytes = await boundedFetch(CONFIG.url, fetchImpl);
  requireThat('0x' + createHash('sha256').update(bytes).digest('hex') === CONFIG.hash, 'Hosted YAML bytes changed. Nothing will be signed.');
  const descriptor = JSON.parse(bytes.toString('utf8'));
  requireThat(descriptor.kind === 'miner' && descriptor.slug === 'referenceforge-onchain' && descriptor.id === 1900999001 && descriptor.base_url === CONFIG.origin && descriptor.auth?.type === 'none'
    && JSON.stringify(descriptor.semantics?.supported_intents) === JSON.stringify(CONFIG.intents)
    && descriptor.endpoints?.length === 2 && descriptor.endpoints.every((e, i) => e.method === 'GET' && e.path === ['/verify-transfer', '/onchain-metric'][i] && e.external_path === e.path && JSON.stringify(e.intents) === JSON.stringify([CONFIG.intents[i]])), 'Pinned descriptor does not match the two reviewed intents.');
  const health = JSON.parse((await boundedFetch(CONFIG.origin + '/health', fetchImpl)).toString('utf8'));
  requireThat(JSON.stringify(health.supported_intents) === JSON.stringify(CONFIG.intents), 'Hosted miner health does not advertise both intents.');
  for (const intent of CONFIG.intents) {
    const result = await provider.call({ to: CONFIG.contract, data: ABI.encodeFunctionData('isCanonicalIntent', [intent]) });
    requireThat(ABI.decodeFunctionResult('isCanonicalIntent', result)[0] === true, intent + ' is not currently canonical.');
  }
  const transaction = { from: account, to: CONFIG.contract, value: 0n,
    data: ABI.encodeFunctionData('registerMiner', [CONFIG.url, CONFIG.hash, feeAddress, minPriceUsdc, CONFIG.intents]) };
  try { await provider.call(transaction); }
  catch { throw new RegistrationError('Miner registration simulation failed. Nothing sent. Inspect contract restrictions or a possible existing registration.'); }
  const latest = await provider.getTransactionCount(account, 'latest'), pending = await provider.getTransactionCount(account, 'pending');
  requireThat(latest === pending, 'Wallet has a pending transaction. Resolve it first.');
  const estimate = await provider.estimateGas(transaction), gasLimit = (estimate * 125n + 99n) / 100n;
  const fee = await provider.getFeeData();
  requireThat(fee.maxFeePerGas > 0n && fee.maxPriorityFeePerGas >= 0n && fee.maxPriorityFeePerGas <= fee.maxFeePerGas, 'Invalid EIP-1559 fee estimate.');
  requireThat(gasLimit > 0n && gasLimit <= 2000000n, 'Unexpected gas requirement.');
  const l2Cost = gasLimit * fee.maxFeePerGas, balance = await provider.getBalance(account);
  requireThat(l2Cost <= CONFIG.maxL2Cost, 'L2 gas exceeds the helper limit of 0.001 test ETH.');
  const approvedCost = l2Cost * 2n < CONFIG.maxL2Cost ? l2Cost * 2n : CONFIG.maxL2Cost;
  return { checkedAt: new Date().toISOString(), chainId: CONFIG.chainId, account, contract: CONFIG.contract,
    url: CONFIG.url, hash: CONFIG.hash, intents: [...CONFIG.intents], feeAddress, minPriceUsdc,
    transaction: { ...transaction, chainId: CONFIG.chainId, type: 2, nonce: pending, gasLimit, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas },
    balance, l2Cost, approvedCost, reserve: CONFIG.reserve, funded: balance >= approvedCost + CONFIG.reserve };
}
export function refreshReviewed(reviewed, current) {
  const age = Date.now() - Date.parse(reviewed.checkedAt);
  requireThat(Number.isFinite(age), 'Review timestamp is missing or invalid. Nothing signed or sent; the helper needs repair.');
  requireThat(age >= 0 && age < 600000, 'Review expired or the system clock changed. Run again to review fresh details. Nothing signed or sent.');
  requireThat(current.transaction.nonce === reviewed.transaction.nonce, 'Wallet nonce changed since review. Inspect pending transactions and run --status. Nothing signed or sent.');
  requireThat(current.account === reviewed.account
    && current.transaction.data === reviewed.transaction.data && current.contract === reviewed.contract && current.hash === reviewed.hash && current.url === reviewed.url
    && current.chainId === reviewed.chainId,
  'Reviewed transaction details changed. Run again to review fresh details. Nothing signed or sent.');
  requireThat(current.l2Cost <= reviewed.approvedCost, 'Refreshed gas exceeds the reviewed ceiling. Run again to review fresh details. Nothing signed or sent.');
  requireThat(current.funded, 'Refreshed funding is insufficient for gas and reserve. Nothing signed or sent.');
}
export async function readRecord(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new RegistrationError('Local attempt record is unreadable. Inspect it before retrying.'); }
}
export async function writeRecord(file, record, exclusive = false) {
  await mkdir(resolve(file, '..'), { recursive: true });
  const target = exclusive ? file : file + '.' + process.pid + '.tmp';
  const handle = await open(target, exclusive ? 'wx' : 'w', 0o600);
  try { await handle.writeFile(json(record)); await handle.sync(); } finally { await handle.close(); }
  if (!exclusive) await rename(target, file);
}
export function validateSignedTransaction(signed, plan) {
  const tx = Transaction.from(signed), expected = plan.transaction;
  requireThat(tx.type === 2 && !tx.accessList?.length && !tx.authorizationList?.length && !tx.blobVersionedHashes?.length
    && sameAddress(tx.from, plan.account) && sameAddress(tx.to, expected.to) && tx.data === expected.data && tx.value === 0n
    && tx.chainId === expected.chainId && tx.nonce === expected.nonce && tx.gasLimit === expected.gasLimit
    && tx.maxFeePerGas === expected.maxFeePerGas && tx.maxPriorityFeePerGas === expected.maxPriorityFeePerGas,
  'Signed transaction does not match the reviewed miner registration. Nothing sent.');
  return tx.hash;
}
export function verifyReceipt(receipt, record) {
  if (!receipt || Number(receipt.status) !== 1 || receipt.hash?.toLowerCase() !== record.txHash.toLowerCase()
    || !sameAddress(receipt.from, record.account) || !sameAddress(receipt.to, record.contract)) return null;
  for (const log of receipt.logs ?? []) {
    if (!sameAddress(log.address, record.contract)) continue;
    let event; try { event = ABI.parseLog(log); } catch { continue; }
    if (event?.name === 'IntentRegistered' && event.args.entityType === 0n && sameAddress(event.args.registrant, record.account)
      && event.args.contentUrl === record.url && event.args.contentHash.toLowerCase() === record.hash.toLowerCase())
      return { registrationId: event.args.registrationId.toString(), entityType: 'miner' };
  }
  return null;
}
export async function finishReceipt(receipt, record, file, receiptVerifier = verifyReceipt) {
  if (!receipt) return record;
  const registration = await receiptVerifier(receipt, record);
  const state = receipt.hash?.toLowerCase() !== record.txHash.toLowerCase() ? 'mined_receipt_unverified'
    : Number(receipt.status) === 0 ? 'reverted' : registration ? 'confirmed' : 'mined_event_unverified';
  const next = { ...record, state, blockNumber: receipt.blockNumber, registration };
  await writeRecord(file, next); return next;
}
// A crash, timeout, revert or unknown response never enables an automatic second send.
export async function sendOnce({ provider, wallet, plan, journalFile, lockFile = journalFile + '.lock', refresh, log = console.log, receiptVerifier = verifyReceipt }) {
  await mkdir(resolve(journalFile, '..'), { recursive: true });
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch { throw new RegistrationError('Another or interrupted attempt holds the lock. Use --status and inspect before retrying.'); }
  try {
    requireThat(!(await readRecord(journalFile)), 'A prior attempt exists. Use --status; do not register again.');
    requireThat(sameAddress(wallet.address, plan.account), 'Key does not belong to the reviewed public account. Nothing sent.');
    requireThat(plan.funded, 'Insufficient Base Sepolia test ETH. Nothing sent.');
    const current = await refresh(); refreshReviewed(plan, current);
    const signed = await wallet.signTransaction(current.transaction), txHash = validateSignedTransaction(signed, current);
    const record = { state: 'broadcast_uncertain', txHash, createdAt: new Date().toISOString(), account: current.account,
      contract: current.contract, chainId: current.chainId, url: current.url, hash: current.hash, intents: current.intents,
      feeAddress: current.feeAddress, minPriceUsdc: current.minPriceUsdc, nonce: current.transaction.nonce, registration: null,
      operation: current.operation ?? 'register', previousRegistrationId: current.previousRegistrationId ?? null };
    await writeRecord(journalFile, record, true);
    log('Transaction hash: ' + txHash); log('https://sepolia.basescan.org/tx/' + txHash);
    try { await provider.broadcastTransaction(signed); }
    catch { log('Broadcast response uncertain. Hash saved. Use --status. No automatic retry.'); return record; }
    record.state = 'pending'; await writeRecord(journalFile, record);
    let receipt; try { receipt = await provider.waitForTransaction(txHash, 1, 45000); } catch { return record; }
    return finishReceipt(receipt, record, journalFile, receiptVerifier);
  } finally { await lock.close(); await unlink(lockFile); }
}
export async function hiddenKey(input = process.stdin, output = process.stdout, { label = 'Private key (hidden; never a seed phrase): ', maxLength = 100 } = {}) {
  requireThat(input.isTTY && output.isTTY, 'Hidden key entry requires your own normal terminal.');
  emitKeypressEvents(input); const wasRaw = !!input.isRaw;
  output.write(label); input.setRawMode(true); input.resume();
  try {
    return await new Promise((resolveKey, rejectKey) => {
      let value = '', tooLong = false;
      const finish = error => { input.off('keypress', onKey); input.off('end', onEnd); error ? rejectKey(error) : resolveKey(value); };
      const onEnd = () => finish(new RegistrationError('Key entry cancelled. Nothing sent.'));
      const onKey = (text, key) => {
        if (key?.ctrl && key.name === 'c' || key?.name === 'escape') return onEnd();
        if (key?.name === 'return' || key?.name === 'enter') return finish(tooLong ? new RegistrationError('Key input too long.') : null);
        if (key?.name === 'backspace') { value = value.slice(0, -1); return; }
        if (key?.ctrl || key?.meta || !text || /[\u0000-\u001f\u007f]/.test(text)) return;
        if (value.length + text.length > maxLength) { tooLong = true; return; } value += text;
      };
      input.on('keypress', onKey); input.once('end', onEnd);
    });
  } finally { input.setRawMode(wasRaw); input.pause(); output.write('\n'); }
}
export function argumentsFor(args) {
  const values = {}; let mode;
  for (let i = 0; i < args.length; i++) {
    if (['--check', '--status', '--interactive'].includes(args[i])) {
      requireThat(!mode, 'Choose one mode: --check, --status or --interactive.'); mode = args[i]; continue;
    }
    requireThat(['--account', '--fee-address', '--floor-price-usdc'].includes(args[i]) && args[i + 1], 'Unknown or incomplete option. Never put a private key in command arguments.');
    requireThat(values[args[i]] === undefined, 'Duplicate command option.'); values[args[i]] = args[++i];
  }
  return { ...values, mode: mode ?? '--check' };
}
async function status(provider, file) {
  const record = await readRecord(file);
  if (!record) { console.log('No attempt recorded by this helper. This does not rule out manual registrations.'); return; }
  const current = await finishReceipt(await provider.getTransactionReceipt(record.txHash), record, file);
  console.log(json(current));
  if (current.registration?.registrationId) {
    const url = 'https://devnode.telegraphprotocol.com/api/miners/' + current.registration.registrationId;
    console.log('Check node admission and both routed intents separately: ' + url);
  }
}
async function main(args) {
  const options = argumentsFor(args), interactive = options.mode === '--interactive';
  requireThat(!interactive || process.stdin.isTTY && process.stdout.isTTY, 'Use your normal terminal for interactive signing. Nothing sent.');
  let account = options['--account'], price = options['--floor-price-usdc'] ?? '0.01', fee = options['--fee-address'];
  if (interactive) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!account) account = (await prompt.question('Public registration wallet address (0x..., NOT a key): ')).trim();
      account = accountAddress(account);
      if (!fee) fee = (await prompt.question('Fee recipient address [Enter = same wallet]: ')).trim() || account;
      if (!options['--floor-price-usdc']) price = (await prompt.question('Floor price per request in USDC [Enter = 0.01]: ')).trim() || '0.01';
    } finally { prompt.close(); }
  }
  account = accountAddress(account); fee = accountAddress(fee ?? account); floorPrice(price);
  const file = resolve(import.meta.dirname, '../reports/miner-terminal-registration', account.toLowerCase() + '-' + CONFIG.hash.slice(2) + '.json');
  const provider = new JsonRpcProvider(CONFIG.rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 }); provider.pollingInterval = 3000;
  try {
    if (options.mode === '--status') { await status(provider, file); return; }
    if (await readRecord(file)) { await status(provider, file); console.log('Previous attempt recorded. No second registration.'); return; }
    const preflight = () => makePlan(provider, account, { feeAddress: fee, price });
    const plan = await preflight();
    console.log(json({ network: 'Base Sepolia (84532), TESTNET ONLY', account, feeAddress: fee, intents: plan.intents,
      yamlUrl: plan.url, yamlSha256: plan.hash, registry: plan.contract, floorPriceUSDC: formatUnits(plan.minPriceUsdc, 6), floorPriceUnits: plan.minPriceUsdc,
      balanceTestETH: formatEther(plan.balance), estimatedL2GasCeilingTestETH: formatEther(plan.l2Cost), approvedMaximumL2GasTestETH: formatEther(plan.approvedCost),
      additionalL1FeeReserveTestETH: formatEther(plan.reserve), funded: plan.funded, nonce: plan.transaction.nonce,
      scope: 'ONE registerMiner transaction for BOTH intents. Gas only; no USDC payment, no update to miner 4838, no WASM.',
      limits: 'Simulation and hosted-byte checks do not prove authenticated validator acceptance, node admission or absence of manual registrations. If already registered manually, cancel and use its ID.' }));
    if (!interactive) return;
    requireThat(plan.funded, 'Insufficient Base Sepolia test ETH for gas and reserve. Nothing signed.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout }); let confirmation;
    try { confirmation = await prompt.question('Type REGISTER_ONCHAIN_MINER to approve ONE transaction for BOTH intents; anything else cancels: '); }
    finally { prompt.close(); }
    if (confirmation !== 'REGISTER_ONCHAIN_MINER') { console.log('Cancelled. No key read and nothing sent.'); return; }
    let key = await hiddenKey(); key = key.trim(); let wallet;
    try {
      requireThat(/^(0x)?[0-9a-fA-F]{64}$/.test(key), 'Invalid private key format. Nothing sent.');
      try { wallet = new Wallet(key.startsWith('0x') ? key : '0x' + key); } catch { throw new RegistrationError('Invalid private key. Nothing sent.'); }
    } finally { key = ''; }
    const result = await sendOnce({ provider, wallet, plan, journalFile: file, refresh: preflight });
    console.log(json({ state: result.state, txHash: result.txHash, registration: result.registration }));
    console.log('Check later: node tools/register-miner.mjs --status --account ' + account);
    if (result.state !== 'confirmed') process.exitCode = 2;
    else console.log('On-chain registration confirmed. Node indexing and routing for both intents must still be checked.');
  } finally { provider.destroy(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    // Library errors can contain signed payloads or signer input. Never print them.
    console.error(error instanceof RegistrationError ? error.message : 'Helper stopped on an RPC or local operation error. No automatic retry. Use --status before trying again.');
    process.exitCode = 1;
  }
}
