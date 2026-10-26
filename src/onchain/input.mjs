import { ServiceError } from '../errors.mjs';

export const NETWORKS = Object.freeze({
  base: { chainId: 8453n, name: 'Base', explorer: 'https://basescan.org', providers: [
    { operator: 'dRPC public RPC', url: 'https://base.drpc.org', maxBatchItems: 3 },
    { operator: 'Allnodes PublicNode', url: 'https://base-rpc.publicnode.com' }
  ] },
  'base-sepolia': { chainId: 84532n, name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org', providers: [
    { operator: 'dRPC public RPC', url: 'https://base-sepolia.drpc.org', maxBatchItems: 3 },
    { operator: 'Allnodes PublicNode', url: 'https://base-sepolia-rpc.publicnode.com' }
  ] }
});
export function networksForEnv(env = {}) {
  if (!env.ALCHEMY_API_KEY) return NETWORKS;
  if (typeof env.ALCHEMY_API_KEY !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(env.ALCHEMY_API_KEY)) fail('RPC_CONFIGURATION','Configured Alchemy key has an invalid format',503);
  return Object.fromEntries(Object.entries(NETWORKS).map(([name,network])=>[name,{...network,providers:[
    {operator:'Alchemy account RPC',url:`https://${name==='base'?'base-mainnet':'base-sepolia'}.g.alchemy.com/v2`,headers:{Authorization:'Bearer '+env.ALCHEMY_API_KEY},maxBatchItems:3},
    network.providers[1]
  ]}]));
}
export function fail(code, message, status = 422) { throw new ServiceError(code, message, status); }
export function address(value, field = 'address') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail('INVALID_ADDRESS', `${field} must be a 20-byte hex address`);
  return value.toLowerCase();
}
export function hash(value, field = 'tx_hash') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('INVALID_HASH', `${field} must be a 32-byte hex hash`);
  return value.toLowerCase();
}
export function uint(value, field = 'amount') {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n) fail('INVALID_INTEGER', `${field} must be an exact unsigned decimal string within uint256`);
  return value;
}
function network(value) {
  const name = ({ '8453': 'base', '84532': 'base-sepolia' })[String(value)] ?? value;
  if (!Object.hasOwn(NETWORKS, name ?? '')) fail('UNSUPPORTED_CHAIN', 'Supply chain=base or chain=base-sepolia; no other networks are supported');
  return name;
}
function checkKeys(p, allowed) {
  if (!p || Array.isArray(p) || typeof p !== 'object') fail('INVALID_PARAMETER', 'Expected a parameter object');
  if (Object.keys(p).some(k => !allowed.includes(k))) fail('UNSUPPORTED_PARAMETER', 'Unknown parameters are refused; RPC URLs and free-form questions are not accepted');
}
export function parseTransfer(p) {
  checkKeys(p, ['chain', 'tx_hash', 'asset', 'token', 'expected_from', 'expected_to', 'expected_amount', 'min_confirmations']);
  if (!['native', 'erc20'].includes(p.asset)) fail('UNSUPPORTED_ASSET', 'Supply asset=native or asset=erc20. Internal ETH transfers, NFTs and bridge settlement are unsupported');
  if (p.asset === 'native' && p.token !== undefined) fail('CONFLICTING_PARAMETER', 'token is valid only for asset=erc20');
  const confirmations = String(p.min_confirmations ?? '1');
  if (!/^[1-9][0-9]{0,5}$/.test(confirmations) || BigInt(confirmations) > 100000n) fail('INVALID_CONFIRMATIONS', 'min_confirmations must be between 1 and 100000 L2 blocks');
  return { chain: network(p.chain), tx_hash: hash(p.tx_hash), asset: p.asset,
    ...(p.asset === 'erc20' ? { token: address(p.token, 'token') } : {}),
    ...(p.expected_from !== undefined ? { expected_from: address(p.expected_from, 'expected_from') } : {}),
    ...(p.expected_to !== undefined ? { expected_to: address(p.expected_to, 'expected_to') } : {}),
    ...(p.expected_amount !== undefined ? { expected_amount: uint(p.expected_amount, 'expected_amount') } : {}),
    min_confirmations: confirmations };
}
export function parseMetric(p) {
  checkKeys(p, ['chain', 'metric', 'tx_hash', 'address', 'token', 'block']);
  if (!['native_balance', 'erc20_balance', 'transaction', 'gas', 'logs'].includes(p.metric)) fail('UNSUPPORTED_METRIC', 'Supported metrics: native_balance, erc20_balance, transaction, gas, logs');
  const chain = network(p.chain);
  if (['transaction', 'gas', 'logs'].includes(p.metric)) {
    if (p.address !== undefined || p.token !== undefined || p.block !== undefined) fail('CONFLICTING_PARAMETER', 'Transaction metrics use the transaction inclusion block; do not supply block/address/token');
    return { chain, metric: p.metric, tx_hash: hash(p.tx_hash) };
  }
  if (p.tx_hash !== undefined || p.metric === 'native_balance' && p.token !== undefined) fail('CONFLICTING_PARAMETER', 'Inapplicable transaction/token input');
  let block = p.block ?? 'safe';
  if (!['safe', 'finalized'].includes(block)) {
    const decimal = typeof block === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(block);
    const hexadecimal = typeof block === 'string' && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/.test(block);
    if (!(decimal || hexadecimal) || BigInt(block) >= 2n ** 64n) fail('INVALID_BLOCK', 'block must be safe, finalized or an exact uint64 block number string; latest and pending are not accepted for state reads');
    block = '0x' + BigInt(block).toString(16);
  }
  return { chain, metric: p.metric, address: address(p.address), block,
    ...(p.metric === 'erc20_balance' ? { token: address(p.token, 'token') } : {}) };
}
export function parseWallet(p) {
  checkKeys(p, ['chain', 'address', 'asset', 'token']);
  const asset = p.asset ?? (p.token === undefined ? 'native' : 'erc20');
  if (!['native', 'erc20'].includes(asset)) fail('UNSUPPORTED_ASSET', 'Wallet balances support native ETH or an ERC-20 contract');
  if (asset === 'native' && p.token !== undefined) fail('CONFLICTING_PARAMETER', 'token is valid only for ERC-20 balances');
  const parsed = parseMetric({ chain: p.chain, address: p.address, metric: asset === 'native' ? 'native_balance' : 'erc20_balance', ...(asset === 'erc20' ? { token: p.token } : {}) });
  return { ...parsed, block: 'current' };
}
