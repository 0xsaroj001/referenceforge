import {ServiceError} from '../errors.mjs';

// Same Intent, distinct contracts. A balance address must never be optional
// merely because a different metric needs a transaction hash instead.
export const METRIC_ROUTES=Object.freeze({
  '/onchain-metric/native-balance':{metric:'native_balance',required:['chain','address'],optional:['block'],description:'Verify the native ETH balance of one exact hex address on Base or Base Sepolia at a safe, finalized or named block. Returns raw wei from two agreeing operators. Requires address; never use a transaction hash here.'},
  '/onchain-metric/erc20-balance':{metric:'erc20_balance',required:['chain','address','token'],optional:['block'],description:'Verify raw ERC-20 base units for an exact wallet and token contract on Base or Base Sepolia at a safe, finalized or named block. Both address and token are mandatory hex addresses. Use /wallet-balance for human token units.'},
  '/onchain-metric/transaction':{metric:'transaction',required:['chain','tx_hash'],optional:[],description:'Verify transaction execution status on Base or Base Sepolia: 1 for success, 0 for reverted, null for pending/unknown. Requires a transaction hash, not a wallet address. Transaction details remain in evidence. Not a primary native-value metric or internal transfer trace.'},
  '/onchain-metric/gas':{metric:'gas',required:['chain','tx_hash'],optional:[],description:'Verify receipt gas USED by one Base/Base Sepolia transaction. Requires tx_hash. Not current gas price, total fee, token price or gas limit.'},
  '/onchain-metric/logs':{metric:'logs',required:['chain','tx_hash'],optional:[],description:'Verify receipt log COUNT for one Base/Base Sepolia transaction. Requires tx_hash. Receipt logs remain in evidence; no chain-wide or time-range aggregation.'}
});
export function metricRouteParams(path,params){
  const route=METRIC_ROUTES[path];if(!route)throw new ServiceError('NOT_FOUND','Unknown metric endpoint',404);
  if(Object.keys(params).some(k=>![...route.required,...route.optional].includes(k)))throw new ServiceError('UNSUPPORTED_PARAMETER','This endpoint fixes its metric; supply only its declared fields',422);
  for(const key of route.required)if(params[key]===undefined||params[key]===null||params[key]==='')throw new ServiceError('MISSING_PARAMETER','This '+route.metric+' endpoint requires '+key,422);
  return {...params,metric:route.metric};
}
export function parameterShape(params){
  const known=new Set(['chain','metric','address','token','block','tx_hash','asset','expected_from','expected_to','expected_amount','min_confirmations','field','lat','lon','hours','start_time','base','quote','amount','country','indicator','year','question','query','q']);
  return Object.entries(params).slice(0,12).map(([name,value])=>({name:known.has(name)?name:'unexpected',type:typeof value,length:typeof value==='string'?value.length:null,...(['address','token','expected_from','expected_to'].includes(name)?{valid_hex_address:typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)}:{})}));
}
