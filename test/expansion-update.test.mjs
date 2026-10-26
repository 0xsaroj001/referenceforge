import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ABI, targetFor, makePlan as actualMakePlan, argumentsFor } from '../tools/expand-miner.mjs';
const makePlan=(provider,options)=>actualMakePlan(provider,{...options,weatherRecordReader:async()=>null});
import { ABI as REGISTRY_ABI } from '../tools/update-miner.mjs';
import { expandedDescriptor } from '../tools/render-expanded-miner.mjs';
import { EXPANDED_INTENTS } from '../src/unified.mjs';
function setup({keepFx=true,changed,activeOld=false,noncanonical,noncePending=6,wrongNetwork=false}={}){
  let simulations=0;
  const target=targetFor(keepFx),provider={
    send:async()=>wrongNetwork?'0x1':'0x14a34',getCode:async()=>'0x6000',
    call:async tx=>{
      if(tx.data.startsWith(REGISTRY_ABI.getFunction('getMiner').selector)){
        const id=Number(REGISTRY_ABI.decodeFunctionData('getMiner',tx.data)[0]);
        const m={owner:CONFIG.owner,url:CONFIG.oldUrl,hash:CONFIG.oldHash,active:id===4844||activeOld,fee:CONFIG.owner,price:10000n,intents:EXPANDED_INTENTS.slice(0,4),...(id===4844?changed:{})};
        return REGISTRY_ABI.encodeFunctionResult('getMiner',[m.owner,m.url,m.hash,m.active,'0x'+'00'.repeat(32),m.fee,m.price,m.intents]);
      }
      if(tx.data.startsWith(ABI.getFunction('isCanonicalIntent').selector)){const i=ABI.decodeFunctionData('isCanonicalIntent',tx.data)[0];return ABI.encodeFunctionResult('isCanonicalIntent',[i!==noncanonical]);}
      simulations++;return ABI.encodeFunctionResult('updateMiner',[5001]);
    },getTransactionCount:async(_,tag)=>tag==='pending'?noncePending:6,estimateGas:async()=>400000n,
    getFeeData:async()=>({maxFeePerGas:2000000n,maxPriorityFeePerGas:1000000n}),getBalance:async()=>1000000000000000000n
  };
  const fetchImpl=async url=>{
    if(url===target.url)return new Response(JSON.stringify(expandedDescriptor({keepFx}),null,2)+'\n');
    const parsed=new URL(url);
    if(parsed.pathname==='/wallet-balance')return Response.json({intent:'WALLET_BALANCE_CHECK',verified_answer:true,chain_id:parsed.searchParams.get('chain')==='base'?'8453':'84532',address:CONFIG.owner,score_value:'0',balance:'0',verification:{sources:[{},{}]}});
    if(parsed.pathname==='/tx')return Response.json({intent:'ONCHAIN_TX_LOOKUP',verified_answer:true,score_value:'1',verification:{sources:[{},{}]}});
    if(parsed.pathname==='/convert')return Response.json({intent:'CURRENCY_EXCHANGE',score_value:'2.000000000000',converted_amount:'2.000000000000',source:{payload_sha256:'fixture'}});
    return Response.json({supported_intents:EXPANDED_INTENTS,rpc_configuration:'alchemy_account_plus_publicnode'});
  };
  return {provider,fetchImpl,simulations:()=>simulations};
}
test('expansion defaults to preserving four existing intents and cannot silently remove FX_NOW',()=>{
  assert.deepEqual(argumentsFor(['--interactive']),{mode:'--interactive',keepFx:true});assert.equal(targetFor().intents.length,7);
  assert.deepEqual(argumentsFor(['--interactive','--replace-fx-reference']),{mode:'--interactive',keepFx:false});assert.equal(targetFor(false).intents.length,6);
  for(const args of [['--private-key'],['--interactive','--check'],['--replace-fx-reference','--replace-fx-reference']])assert.throws(()=>argumentsFor(args));
});
test('expansion cannot proceed on shared public RPCs or fabricated/incomplete readiness',async()=>{
  const f=setup();
  await assert.rejects(makePlan(f.provider,{fetchImpl:async(url)=>url.endsWith('/health')?Response.json({supported_intents:EXPANDED_INTENTS,rpc_configuration:'shared_public_rpcs'}):f.fetchImpl(url)}),/Configure the Alchemy/);
  await assert.rejects(makePlan(f.provider,{fetchImpl:async(url)=>url.includes('/wallet-balance?')?Response.json({intent:'WALLET_BALANCE_CHECK',verified_answer:false}):f.fetchImpl(url)}),/readiness check failed/);
  assert.equal(f.simulations(),0);
});
for(const keepFx of [true,false])test('expansion calldata pins exact '+(keepFx?7:6)+' intents and updates 4844 only',async()=>{
  const f=setup({keepFx}),p=await makePlan(f.provider,{keepFx,fetchImpl:f.fetchImpl}),d=ABI.decodeFunctionData('updateMiner',p.transaction.data);
  assert.equal(d[0],4844n);assert.equal(d[1],targetFor(keepFx).url);assert.equal(d[2],targetFor(keepFx).hash);assert.equal(d[3],CONFIG.owner);assert.equal(d[4],10000n);assert.deepEqual([...d[5]],targetFor(keepFx).intents);
  assert.equal(p.transaction.value,0n);assert.equal(p.previousRegistrationId,4844);assert.equal(f.simulations(),1);
});
test('expansion blocks changed identity, fee, hash, pending wallet, noncanonical intents and unfinished retirement',async()=>{
  for(const options of [{wrongNetwork:true},{activeOld:true},{changed:{owner:'0x'+'11'.repeat(20)}},{changed:{price:20000n}},{changed:{hash:'0x'+'00'.repeat(32)}},{changed:{active:false}},{noncanonical:'WALLET_BALANCE_CHECK'},{noncePending:7}]){
    const f=setup(options);await assert.rejects(makePlan(f.provider,{fetchImpl:f.fetchImpl}));
  }
  const f=setup();await assert.rejects(makePlan(f.provider,{fetchImpl:async()=>new Response('altered')}),/hash changed/);
});

test('recorded weather update blocks the superseded seven-intent helper',async()=>{const f=setup();await assert.rejects(actualMakePlan(f.provider,{fetchImpl:f.fetchImpl,weatherRecordReader:async()=>({state:'confirmed'})}),/weather upgrade attempt is already recorded/);assert.equal(f.simulations(),0);});
