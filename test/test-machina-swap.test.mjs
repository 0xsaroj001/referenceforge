import test from 'node:test';import assert from 'node:assert/strict';
import {SWAP_CONFIG as c,SWAP_ABI as abi,swapAmounts,swapTransaction,inspectTestMachinaSwap} from '../tools/lib/test-machina-swap.mjs';
test('already funded wallets do not need a second swap',()=>{
  assert.deepEqual(swapAmounts({bond:5n,balance:5n,quote:10n}),{needed:0n,minOut:0n,required:false});
  assert.equal(swapAmounts({bond:5n,balance:6n,quote:10n}).required,false);
});
test('minimum output retains one percent slippage and covers the shortfall buffer',()=>{
  assert.deepEqual(swapAmounts({bond:5000n,balance:4500n,quote:1000n}),{needed:500n,minOut:990n,required:true});
  assert.throws(()=>swapAmounts({bond:5000n,balance:4500n,quote:510n}),/safety buffer/);
  assert.throws(()=>swapAmounts({bond:1n,balance:-1n,quote:5n}),/Invalid amounts/);
});
test('encoded swap spends exactly one test USDC with fixed owner recipient and deadline',()=>{
  const tx=swapTransaction(1000000000000000000n,1800000000n);assert.equal(tx.to,c.router);assert.equal(tx.from,c.owner);assert.equal(tx.value,'0x0');assert.equal(BigInt(tx.chainId),11155111n);
  const outer=abi.decodeFunctionData('multicall(uint256,bytes[])',tx.data);assert.equal(outer[0],1800000000n);assert.equal(outer[1].length,1);
  const params=abi.decodeFunctionData('exactInputSingle',outer[1][0])[0];assert.equal(params.tokenIn,c.usdc);assert.equal(params.tokenOut,c.machina);assert.equal(params.recipient,c.owner);assert.equal(params.amountIn,1000000n);assert.equal(params.amountOutMinimum,1000000000000000000n);assert.equal(params.fee,3000n);assert.equal(params.sqrtPriceLimitX96,0n);
  assert.throws(()=>swapTransaction(0n,1800000000n));
});
test('wrong chain and stale head stop before any token call',async()=>{
  const methods=[];await assert.rejects(inspectTestMachinaSwap({send:async method=>{methods.push(method);return '0x1';}}),/Wrong chain/);assert.deepEqual(methods,['eth_chainId']);
  methods.length=0;await assert.rejects(inspectTestMachinaSwap({send:async method=>{methods.push(method);return method==='eth_chainId'?'0xaa36a7':method==='eth_blockNumber'?'0x64':{number:'0x64',timestamp:'0x1'};}}),/stale/);assert.deepEqual(methods,['eth_chainId','eth_blockNumber','eth_getBlockByNumber']);
});
