import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {JsonRpcProvider} from 'ethers';
import {SWAP_CONFIG,inspectTestMachinaSwap} from './lib/test-machina-swap.mjs';
assert.equal(process.argv.length,2,'Read-only helper accepts no key or arguments');
const provider=new JsonRpcProvider(SWAP_CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{const report=await inspectTestMachinaSwap(provider);await mkdir('reports/wasm-v2',{recursive:true});await writeFile('reports/wasm-v2/free-usdc-swap-preflight.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}finally{provider.destroy();}
