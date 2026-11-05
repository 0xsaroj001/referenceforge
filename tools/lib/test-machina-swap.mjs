// Fixed Ethereum Sepolia test-token funding plan. No signer or broadcast.
import assert from 'node:assert/strict';
import {Interface,AbiCoder,keccak256,toBeHex,formatUnits} from 'ethers';
export const SWAP_CONFIG=Object.freeze({chainId:11155111n,rpc:'https://ethereum-sepolia-rpc.publicnode.com',owner:'0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3',registry:'0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b',usdc:'0xcc194e1a843B658526D0D5C431f670028582Ae17',machina:'0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4',pool:'0x3AF68f69b9c9Cb36bAc5dac6a9e2899eeB03B0f7',factory:'0x0227628f3F023bb0B980b67D528571c95c6DaC1c',quoter:'0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',router:'0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',amountIn:1000000n,fee:3000,slippageBps:100n,maxGas:500000n,maxGasCost:1000000000000000n,reserve:1000000000000000n});
export const SWAP_ABI=new Interface([
  'function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)',
  'function factory() view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function getPool(address,address,uint24) view returns(address)',
  'function entityBonds() view returns(uint64,uint64,uint256,uint256)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256 amountOut,uint160,uint32,uint256)',
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)',
  'function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])'
]);
const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export const SWAP_CODE_HASHES=Object.freeze({
  registry:'0xafd6a6ad2ef0a3ff8318e4957fd231c109a75a64cb69864dd9c2114c4095b371',
  usdc:'0x86c9fcb929a0c4828eec099f12f8a415a67ee7ddef263040a8c51f831c8b40b2',
  machina:'0x252cc18be94853b1c77a75f4043ec292590a25aaa6d0d9ea8833094aa1e89129',
  pool:'0x152232b60920d6bc8a1fec35ee1dfe0331131dd3dd8b05e2d040abb2478673e7',
  factory:'0xacb5afea1f8877239fadd30358add13f2f9d4fb80175402c686d392295224fef',
  quoter:'0xe4068c0e5f3f2d9980793dd4314d2222dca27d03fd999cb5dca580fd90ceea0e',
  router:'0xe7f98ee73dfe6d5c96cbf8936920f496b1b82f24326d6a415b4144a2252271de'
});
export function swapAmounts({bond,balance,quote}){
  assert([bond,balance,quote].every(x=>typeof x==='bigint'&&x>=0n),'Invalid amounts');
  if(balance>=bond)return {needed:0n,minOut:0n,required:false};
  const needed=bond-balance,minOut=quote*(10000n-SWAP_CONFIG.slippageBps)/10000n;
  assert(minOut>=needed+needed/50n,'One test USDC would not cover the bond shortfall with the safety buffer');
  return {needed,minOut,required:true};
}
export function swapTransaction(minOut,deadline){
  const c=SWAP_CONFIG;assert(typeof minOut==='bigint'&&minOut>0n&&typeof deadline==='bigint'&&deadline>0n);
  const inner=SWAP_ABI.encodeFunctionData('exactInputSingle',[[c.usdc,c.machina,c.fee,c.owner,c.amountIn,minOut,0]]);
  return {from:c.owner,to:c.router,value:'0x0',chainId:toBeHex(c.chainId),data:SWAP_ABI.encodeFunctionData('multicall(uint256,bytes[])',[deadline,[inner]])};
}
export async function inspectTestMachinaSwap(provider){
  const c=SWAP_CONFIG;assert.equal(BigInt(await provider.send('eth_chainId',[])),c.chainId,'Wrong chain; test swap only');
  const block=await provider.send('eth_blockNumber',[]),header=await provider.send('eth_getBlockByNumber',[block,false]);assert(header&&BigInt(header.number)===BigInt(block),'Pinned header unavailable');
  assert(Math.abs(Math.floor(Date.now()/1000)-Number(BigInt(header.timestamp)))<180,'RPC head is stale');
  const call=async(to,data,overrides)=>provider.send('eth_call',[{to,data},block,...(overrides?[overrides]:[])]);
  const read=async(to,name,args=[])=>SWAP_ABI.decodeFunctionResult(name,await call(to,SWAP_ABI.encodeFunctionData(name,args)));
  const codes=await Promise.all(Object.entries(SWAP_CODE_HASHES).map(async([name,expected])=>{const address=c[name],code=await provider.send('eth_getCode',[address,block]);assert(/^0x(?:[0-9a-fA-F]{2})+$/.test(code),'Missing contract code');assert.equal(keccak256(code),expected,'Reviewed contract bytecode changed: '+name);return {address,keccak256:expected};}));
  const [usdcDecimals,machinaDecimals,token0,token1,fee,factory,routerFactory,quoterFactory,pool,bonds,balance,usdcBalance,allowance,eth,latestNonce,pendingNonce]=await Promise.all([
    read(c.usdc,'decimals'),read(c.machina,'decimals'),read(c.pool,'token0'),read(c.pool,'token1'),read(c.pool,'fee'),read(c.pool,'factory'),read(c.router,'factory'),read(c.quoter,'factory'),read(c.factory,'getPool',[c.usdc,c.machina,c.fee]),read(c.registry,'entityBonds'),read(c.machina,'balanceOf',[c.owner]),read(c.usdc,'balanceOf',[c.owner]),read(c.usdc,'allowance',[c.owner,c.router]),provider.send('eth_getBalance',[c.owner,block]),provider.send('eth_getTransactionCount',[c.owner,'latest']),provider.send('eth_getTransactionCount',[c.owner,'pending'])
  ]);
  assert(usdcDecimals[0]===6n&&machinaDecimals[0]===18n,'Token decimal mismatch');assert(equal(token0[0],c.usdc)&&equal(token1[0],c.machina)&&fee[0]===BigInt(c.fee),'Wrong pool pair or fee');assert([factory[0],routerFactory[0],quoterFactory[0]].every(x=>equal(x,c.factory))&&equal(pool[0],c.pool),'Wrong Uniswap factory/pool');assert.equal(latestNonce,pendingNonce,'Owner already has a pending transaction');assert(BigInt(eth)>c.reserve,'Insufficient test ETH gas reserve');
  const quoted=await read(c.quoter,'quoteExactInputSingle',[[c.usdc,c.machina,c.amountIn,c.fee,0]]),amounts=swapAmounts({bond:bonds[2],balance:balance[0],quote:quoted[0]});
  const base={checked_at:new Date().toISOString(),block:String(BigInt(block)),chain_id:String(c.chainId),owner:c.owner,contracts:codes,bond_machina:formatUnits(bonds[2],18),wallet_machina:formatUnits(balance[0],18),wallet_test_usdc:formatUnits(usdcBalance[0],6),wallet_test_eth:formatUnits(BigInt(eth),18),required:amounts.required,shortfall_machina:formatUnits(amounts.needed,18),input_test_usdc:'1.0',quoted_machina:formatUnits(quoted[0],18),minimum_machina:formatUnits(amounts.minOut,18),slippage_bps:String(c.slippageBps),read_only:true,state_changed:false};
  if(!amounts.required)return {...base,steps:[],reason:'Already funded; do not swap again'};
  assert(usdcBalance[0]>=c.amountIn,'The required existing free test USDC is unavailable; no mint or real-money funding is automatic');
  const deadline=BigInt(header.timestamp)+300n,swap=swapTransaction(amounts.minOut,deadline),approve={from:c.owner,to:c.usdc,value:'0x0',chainId:toBeHex(c.chainId),data:SWAP_ABI.encodeFunctionData('approve',[c.router,c.amountIn])};
  // Verify inferred allowance storage with the real token getter before overriding
  // only that allowance in the eth_call. Actual owner balance is never replaced.
  const coder=AbiCoder.defaultAbiCoder(),slot=keccak256(coder.encode(['address','bytes32'],[c.router,keccak256(coder.encode(['address','uint256'],[c.owner,5]))]));
  const override=value=>({[c.usdc]:{stateDiff:{[slot]:toBeHex(value,32)}}});
  const sentinel=123456789n;assert.equal(SWAP_ABI.decodeFunctionResult('allowance',await call(c.usdc,SWAP_ABI.encodeFunctionData('allowance',[c.owner,c.router]),override(sentinel)))[0],sentinel,'USDC allowance slot was not verified');
  const raw=await provider.send('eth_call',[{from:swap.from,to:swap.to,data:swap.data,value:'0x0'},block,override(c.amountIn)]),nested=SWAP_ABI.decodeFunctionResult('multicall(uint256,bytes[])',raw)[0];assert.equal(nested.length,1);const actual=SWAP_ABI.decodeFunctionResult('exactInputSingle',nested[0])[0];assert.equal(actual,quoted[0],'Router simulation disagrees with quoter');assert(actual>=amounts.minOut,'Minimum output failed');
  const needsApproval=allowance[0]<c.amountIn;
  if(needsApproval)assert.equal(SWAP_ABI.decodeFunctionResult('approve',await provider.send('eth_call',[{from:approve.from,to:approve.to,data:approve.data},block]))[0],true,'Approval simulation failed');
  const strip=tx=>({from:tx.from,to:tx.to,data:tx.data,value:'0x0'});
  const [swapGas,approveGas,feeData]=await Promise.all([provider.send('eth_estimateGas',[strip(swap),block,override(c.amountIn)]),needsApproval?provider.send('eth_estimateGas',[strip(approve),block]):'0x0',provider.getFeeData()]);
  assert(feeData.maxFeePerGas!==null&&feeData.maxPriorityFeePerGas!==null,'EIP1559 fees unavailable');
  const attachGas=(tx,estimate)=>{const limit=(BigInt(estimate)*125n+99n)/100n;assert(limit>0n&&limit<=c.maxGas,'Gas limit exceeds ceiling');assert(limit*feeData.maxFeePerGas<=c.maxGasCost,'Transaction fee exceeds test ETH ceiling');return {...tx,gas:toBeHex(limit),maxFeePerGas:toBeHex(feeData.maxFeePerGas),maxPriorityFeePerGas:toBeHex(feeData.maxPriorityFeePerGas)};};
  const steps=[...(needsApproval?[{kind:'approve_exact_one_test_usdc',transaction:attachGas(approve,approveGas)}]:[]),{kind:'swap_one_test_usdc_for_test_machina',transaction:attachGas(swap,swapGas)}];
  const maxTotal=steps.reduce((n,s)=>n+BigInt(s.transaction.gas)*feeData.maxFeePerGas,0n);assert(BigInt(eth)>=maxTotal+c.reserve,'Test ETH balance cannot cover capped fees and reserve');
  assert(Number(deadline)*1000-Date.now()>120000,'Plan too close to deadline; refresh');
  return {...base,deadline:String(deadline),allowance_test_usdc:formatUnits(allowance[0],6),approval_required:needsApproval,steps,maximum_total_gas_cost_test_eth:formatUnits(maxTotal,18),simulation:{ok:true,output_machina:formatUnits(actual,18),original_token_code:true,hypothetical_allowance_only:true,actual_usdc_balance_used:true},transaction_ready:false,note:'No signer or broadcast. This plan expires at deadline. Refresh after approval and immediately before swap wallet review. No mint is needed.'};
}
