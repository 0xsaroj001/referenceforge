import { unifiedDescriptor, UNIFIED_ORIGIN } from './render-unified-miner.mjs';
export { UNIFIED_ORIGIN };
export function expandedDescriptor({ keepFx = true, baseUrl = UNIFIED_ORIGIN } = {}) {
  const old = unifiedDescriptor({ baseUrl });
  const param = (name, description) => ({ name, type: 'string', intents: ['*'], description });
  const endpoint = (path, intent, description, required, optional = []) => ({ path, external_path: path, method: 'GET', intents: [intent], description,
    params: { query: { required: required.map(x => param(...x)), optional: optional.map(x => param(...x)) } } });
  return { ...old,
    description: old.description + ' Dedicated currency conversion, transaction lookup and current wallet balance endpoints preserve exact units and source evidence. FX_NOW, when retained, remains limited to daily ECB references; institutional live mid-market rates/spreads are not implemented.',
    endpoints: [...old.endpoints.filter(e => keepFx || e.path !== '/fx'),
      endpoint('/convert', 'CURRENCY_EXCHANGE', 'Convert an amount between ECB-covered currencies using latest published daily reference rates. The primary score is the converted amount, not the rate; default amount 1 also returns an exchange rate. This is not an executable, intraday or historical quote.',
        [['base','Three-letter source currency, such as USD'],['quote','Three-letter destination currency, such as EUR']],
        [['amount','Exact nonnegative decimal amount; default 1. Example 100'],['question','Original whole question, to preserve amount and scope constraints']]),
      endpoint('/tx', 'ONCHAIN_TX_LOOKUP', 'Look up one exact transaction on Base or Base Sepolia, including execution status, gas used, sender, recipient, native value, inclusion block, confirmations and receipt logs. Select field to match the requested primary value. Pending/unknown is inconclusive, not proof of absence. No internal execution traces or other chains.',
        [['chain','base or base-sepolia'],['tx_hash','Exact 32-byte transaction hash']],
        [['field','Primary answer: status (default, 1 success / 0 reverted), gas_used, value_wei, from, to or block_number; other details remain in the response']]),
      endpoint('/wallet-balance', 'WALLET_BALANCE_CHECK', 'Current native ETH or ERC-20 balance of one Base/Base Sepolia address, resolved to a fresh common canonical block from two independent operators. Returns exact human units and raw base units; ERC-20 decimals is verified at the same block. No ENS, other chains, portfolio valuation or token legitimacy claims. Missing/nonstandard decimals makes a human token balance unavailable; it is never assumed to be 18.',
        [['chain','base or base-sepolia'],['address','Exact 20-byte wallet address; ENS is unsupported']],
        [['asset','native (default without token) or erc20 (default when token is supplied)'],['token','Required ERC-20 contract address for erc20; forbidden for native']])],
    semantics: { ...old.semantics, supported_intents: [...old.semantics.supported_intents.filter(i => keepFx || i !== 'FX_NOW'), 'CURRENCY_EXCHANGE','ONCHAIN_TX_LOOKUP','WALLET_BALANCE_CHECK'] }
  };
}
