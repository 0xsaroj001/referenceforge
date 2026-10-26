import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rmdir,mkdir} from 'node:fs/promises';
import {makeRoutingPlan,TARGET} from '../tools/refine-routing-miner.mjs';
import {CONFIG,ABI} from '../tools/expand-miner.mjs';
import {TARGET as OLD} from '../tools/upgrade-weather-miner.mjs';
import {ABI as REGISTRY} from '../tools/update-miner.mjs';
import {routingDescriptor} from '../tools/render-routing-miner.mjs';
import {refreshReviewed,sendOnce,RegistrationError} from '../tools/register-miner.mjs';
await mkdir("reports/network-quality",{recursive:true});
function fixture({changed={},pending=7,canonical=true}={}){
  let simulations=0;const provider={send:async()=> '0x14a34',getCode:async()=> '0x1234',call:async tx=>{
    if(tx.data.startsWith(REGISTRY.getFunction('getMiner').selector)){const id=Number(REGISTRY.decodeFunctionData('getMiner',tx.data)[0]);return REGISTRY.encodeFunctionResult('getMiner',[changed.owner??CONFIG.owner,OLD.url,changed.hash??OLD.hash,id===4850&&!changed.inactive,'0x'+'11'.repeat(32),CONFIG.owner,changed.price??10000n,TARGET.intents]);}
    if(tx.data.startsWith(ABI.getFunction('isCanonicalIntent').selector))return ABI.encodeFunctionResult('isCanonicalIntent',[canonical]);
    simulations++;return ABI.encodeFunctionResult('updateMiner',[9000]);
  },getTransactionCount:async(_,tag)=>tag==='latest'?7:pending,estimateGas:async()=>500000n,getFeeData:async()=>({maxFeePerGas:2000000n,maxPriorityFeePerGas:1000000n}),getBalance:async()=>1000000000000000000n};
  const fetchImpl=async url=>{
    if(url===TARGET.url)return new Response(JSON.stringify(routingDescriptor(),null,2)+'\n');if(url.endsWith('/health'))return Response.json({routing_contract_version:'explicit_metrics_v1',rpc_configuration:'alchemy_account_plus_publicnode',supported_intents:TARGET.intents});
    const native=url.includes('/native-balance?');return Response.json({intent:'ONCHAIN_METRIC_VERIFY',chain_id:'84532',metric:native?'native_balance':'gas',address:CONFIG.owner,tx_hash:'0x83b18dedaa93772e3c2456a181bd1090be719c8494cc9b32008af51f46684b34',verified_answer:true,score_value:'1',verification:{sources:[{},{}]}});
  };return {provider,fetchImpl,simulations:()=>simulations};
}
test('routing revision pins active 4850, same ten intents, descriptor bytes, fee and fresh review timestamp',async()=>{
  const f=fixture(),p=await makeRoutingPlan(f.provider,{fetchImpl:f.fetchImpl}),fresh=await makeRoutingPlan(f.provider,{fetchImpl:f.fetchImpl});refreshReviewed(p,fresh);
  const tx=ABI.decodeFunctionData('updateMiner',p.transaction.data);assert.equal(tx[0],4850n);assert.equal(tx[1],TARGET.url);assert.equal(tx[2],TARGET.hash);assert.equal(tx[3],CONFIG.owner);assert.equal(tx[4],10000n);assert.deepEqual([...tx[5]],TARGET.intents);assert.equal(p.transaction.value,0n);assert.equal(p.transaction.nonce,7);assert(Number.isFinite(Date.parse(p.checkedAt)));
});
test('routing revision rejects changed identity, inactive source, changed fee, pending nonce and noncanonical intents',async()=>{
  for(const options of [{changed:{owner:'0x'+'22'.repeat(20)}},{changed:{hash:'0x'+'00'.repeat(32)}},{changed:{price:20000n}},{changed:{inactive:true}},{pending:8},{canonical:false}]){const f=fixture(options);await assert.rejects(makeRoutingPlan(f.provider,{fetchImpl:f.fetchImpl}));}
});
test('routing revision rejects altered artifact and incomplete or wrong-chain readiness before simulation',async()=>{
  for(const alter of [url=>url===TARGET.url?new Response('altered'):null,url=>url.includes('/native-balance?')?Response.json({intent:'ONCHAIN_METRIC_VERIFY',verified_answer:true,chain_id:'1'}):null,url=>url.endsWith('/health')?Response.json({supported_intents:TARGET.intents}):null]){const f=fixture();await assert.rejects(makeRoutingPlan(f.provider,{fetchImpl:async u=>alter(u)??f.fetchImpl(u)}));assert.equal(f.simulations(),0);}
});
test('actual revision plan reaches a mock signer after refresh without any broadcast or journal',async()=>{
  const f=fixture(),plan=await makeRoutingPlan(f.provider,{fetchImpl:f.fetchImpl}),dir=await mkdtemp('reports/network-quality/signer-test-');let signs=0,broadcasts=0;f.provider.broadcastTransaction=async()=>{broadcasts++;};
  await assert.rejects(sendOnce({provider:f.provider,wallet:{address:CONFIG.owner,signTransaction:async()=>{signs++;throw new RegistrationError('mock signer reached');}},plan,journalFile:dir+'/attempt.json',refresh:()=>makeRoutingPlan(f.provider,{fetchImpl:f.fetchImpl})}),/mock signer reached/);assert.equal(signs,1);assert.equal(broadcasts,0);await rmdir(dir);
});
