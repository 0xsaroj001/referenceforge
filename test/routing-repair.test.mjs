import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CONFIG} from '../tools/expand-miner.mjs';
import {ABI as READ} from '../tools/update-miner.mjs';
import {sendOnce,refreshReviewed} from '../tools/register-miner.mjs';
import {REPAIR,ABI,makeRepairPlan,verifyReplacement,repairStatus,ownedRegistrations,requireFreshRepairAttempt} from '../tools/repair-routing-miner.mjs';
import {routingDescriptor} from '../tools/render-routing-miner.mjs';
import {finalizationSteps,executeFinalizationSteps} from '../tools/finalize-referenceforge.mjs';
const newer=4900;
function setup({replaced=false,oldChange={},priorChange={},nextChange={},nodeChange={},catalogueChange={},extraRow,wrongNetwork=false,noncanonical=false,publicRuntime='0.5.4',pendingNonce=8,funded=true}={}){
 const old={owner:CONFIG.owner,url:REPAIR.oldUrl,hash:REPAIR.oldHash,active:!replaced,feeAddress:CONFIG.owner,minPriceUsdc:10000n,intents:REPAIR.oldIntents,...oldChange},prior={owner:CONFIG.owner,url:REPAIR.url,hash:REPAIR.hash,active:true,feeAddress:CONFIG.owner,minPriceUsdc:10000n,intents:REPAIR.intents,...priorChange},next={...prior,...nextChange};
 const miners=new Map([[REPAIR.oldId,old],[REPAIR.priorId,prior],[newer,next]]);let broadcasts=0;
 const provider={send:async()=>wrongNetwork?'0x1':'0x14a34',getCode:async()=>'0x6000',getTransactionCount:async(_,tag)=>tag==='pending'?pendingNonce:8,getBalance:async()=>funded?1000000000000000000n:0n,estimateGas:async()=>300000n,getFeeData:async()=>({maxFeePerGas:2000000n,maxPriorityFeePerGas:1000000n}),call:async tx=>{
  if(tx.data.startsWith(READ.getFunction('getMiner').selector)){const id=Number(READ.decodeFunctionData('getMiner',tx.data)[0]),m=miners.get(id);return READ.encodeFunctionResult('getMiner',[m.owner,m.url,m.hash,m.active,'0x'+'00'.repeat(32),m.feeAddress,m.minPriceUsdc,m.intents]);}
  if(tx.data.startsWith(ABI.getFunction('isCanonicalIntent').selector))return ABI.encodeFunctionResult('isCanonicalIntent',[!noncanonical]);
  return ABI.encodeFunctionResult('updateMiner',[newer]);},broadcastTransaction:async()=>{broadcasts++;throw Error('No fixture broadcasts');}};
 const rows=[{registration_id:REPAIR.priorId,miner_address:CONFIG.owner,slug:'referenceforge-numeric',activation_status:'superseded',yaml_url:REPAIR.url,yaml_hash:REPAIR.hash.slice(2)},{registration_id:replaced?newer:REPAIR.oldId,miner_address:CONFIG.owner,slug:'referenceforge-numeric',activation_status:'active',yaml_url:replaced?REPAIR.url:REPAIR.oldUrl,yaml_hash:(replaced?REPAIR.hash:REPAIR.oldHash).slice(2)}];if(extraRow)rows.push({...rows.at(-1),registration_id:newer+1});
 const node={activation_status:'active',registration_id:replaced?newer:REPAIR.oldId,miner_address:CONFIG.owner,yaml_url:replaced?REPAIR.url:REPAIR.oldUrl,yaml_hash:(replaced?REPAIR.hash:REPAIR.oldHash).slice(2),supported_intents:replaced?REPAIR.intents:REPAIR.oldIntents,fee_address:CONFIG.owner,min_price_usdc:10000,...nodeChange};
 const catalogue=[{slug:'referenceforge-numeric',wallet_address:CONFIG.owner,activation_status:'active',yaml_url:REPAIR.url,supported_intents:REPAIR.intents,endpoints:routingDescriptor().endpoints,...catalogueChange}];
 const urls=[],fetchImpl=async url=>{urls.push(url);if(url===REPAIR.url)return new Response(JSON.stringify(routingDescriptor(),null,2)+'\n');if(url.endsWith('/yamls'))return Response.json({address:CONFIG.owner,count:rows.length,yamls:rows});if(url.endsWith('/health'))return Response.json({version:publicRuntime,rpc_configuration:'alchemy_account_plus_publicnode',supported_intents:REPAIR.intents,routing_contract_version:'explicit_metrics_v1'});if(url.includes('/api/miners?'))return Response.json(catalogue);return Response.json({miner:node});};
 return {provider,fetchImpl,miners,rows,node,catalogue,urls,broadcasts:()=>broadcasts};
}
test('final command defaults to read-only; only explicit interactive mode schedules deployment then reviewed repair',()=>{
 assert.deepEqual(finalizationSteps([]),[['tools/release-quality.mjs','--check'],['tools/repair-routing-miner.mjs','--check']]);assert.deepEqual(finalizationSteps(['--interactive']),[['tools/repair-routing-miner.mjs','--preflight'],['tools/release-quality.mjs','--deploy'],['tools/repair-routing-miner.mjs','--interactive']]);assert.deepEqual(finalizationSteps(['--status']),[['tools/repair-routing-miner.mjs','--status']]);for(const args of [['--key','secret'],['--deploy'],['--interactive','--check']])assert.throws(()=>finalizationSteps(args));
});
test('failed registration preflight stops before upload; failed deployment stops before signing',()=>{
 const calls=[];assert.equal(executeFinalizationSteps(['--interactive'],step=>{calls.push(step);return {status:1};}),1);assert.deepEqual(calls,[['tools/repair-routing-miner.mjs','--preflight']]);
 const deployed=[];assert.equal(executeFinalizationSteps(['--interactive'],step=>{deployed.push(step);return {status:deployed.length===2?1:0};}),1);assert.deepEqual(deployed,[['tools/repair-routing-miner.mjs','--preflight'],['tools/release-quality.mjs','--deploy']]);
 const success=[];assert.equal(executeFinalizationSteps(['--interactive'],step=>{success.push(step);return {status:0};}),0);assert.deepEqual(success,finalizationSteps(['--interactive']));
});
test('repair pins 4864, existing routing hash, exact ten intents, zero value, owner and fee floor',async()=>{
 const f=setup(),p=await makeRepairPlan(f.provider,f),d=ABI.decodeFunctionData('updateMiner',p.transaction.data);assert.equal(d[0],4864n);assert.equal(d[1],REPAIR.url);assert.equal(d[2],REPAIR.hash);assert.deepEqual([...d[5]],[...REPAIR.intents]);assert.equal(d[3],CONFIG.owner);assert.equal(d[4],10000n);assert.equal(p.transaction.value,0n);assert.equal(p.previousRegistrationId,4864);assert.equal(p.runtimeReady,true);assert.equal(p.funded,true);assert.equal(f.broadcasts(),0);assert(f.urls.some(u=>u.includes(CONFIG.owner.toLowerCase()+'/yamls')));
});
test('changed ownership, artifact, fee, intents, inactive old registration, new holder or wrong chain stop the repair',async()=>{
 for(const options of [{wrongNetwork:true},{oldChange:{owner:'0x'+'11'.repeat(20)}},{oldChange:{active:false}},{oldChange:{hash:'0x'+'11'.repeat(32)}},{oldChange:{minPriceUsdc:20000n}},{oldChange:{intents:REPAIR.intents}},{priorChange:{active:false}},{extraRow:true},{nodeChange:{activation_status:'superseded'}},{nodeChange:{yaml_url:REPAIR.url}},{noncanonical:true},{pendingNonce:9}]){const f=setup(options);await assert.rejects(makeRepairPlan(f.provider,f));assert.equal(f.broadcasts(),0);}
});
test('altered hosted bytes, incomplete owned history and HTTP failures refuse preflight',async()=>{
 const f=setup();await assert.rejects(makeRepairPlan(f.provider,{fetchImpl:async url=>url===REPAIR.url?new Response('changed'):f.fetchImpl(url)}),/artifact changed/);
 await assert.rejects(makeRepairPlan(f.provider,{fetchImpl:async url=>url===REPAIR.url?new Response('\uFEFF'+JSON.stringify(routingDescriptor(),null,2)+'\n'):f.fetchImpl(url)}),/artifact changed/);
 await assert.rejects(ownedRegistrations(async()=>Response.json({count:2,yamls:[]})),/Incomplete/);await assert.rejects(makeRepairPlan(f.provider,{fetchImpl:async()=>new Response('fail',{status:503})}),/unavailable/);
});
test('old public runtime and missing funds are visible in read-only review without a signature or broadcast',async()=>{
 const f=setup({publicRuntime:'0.5.2',funded:false}),p=await makeRepairPlan(f.provider,f);assert.equal(p.runtimeReady,false);assert.equal(p.publicRuntime,'0.5.2');assert.equal(p.funded,false);assert.equal(f.broadcasts(),0);
});
test('replacement requires chain, latest owned registration, node and all catalogue endpoint contracts',async()=>{
 const f=setup({replaced:true});assert.equal((await verifyReplacement(f.provider,newer,f)).catalogueComplete,true);
 for(const options of [{replaced:false},{replaced:true,wrongNetwork:true},{replaced:true,nodeChange:{activation_status:'pending'}},{replaced:true,nextChange:{active:false}},{replaced:true,extraRow:true},{replaced:true,nodeChange:{supported_intents:REPAIR.oldIntents}},{replaced:true,catalogueChange:{yaml_url:REPAIR.oldUrl}},{replaced:true,catalogueChange:{endpoints:routingDescriptor().endpoints.slice(0,2)}},{replaced:true,catalogueChange:{supported_intents:REPAIR.oldIntents}}]){const g=setup(options);await assert.rejects(verifyReplacement(g.provider,newer,g));}
});
test('actual repair plan passes shared review guards but stops at an injected local signature boundary',async()=>{
 const f=setup(),p=await makeRepairPlan(f.provider,f);refreshReviewed(p,await makeRepairPlan(f.provider,f));let signatures=0;const file=resolve('reports/network-quality/test-repair-'+randomUUID()+'.json');
 await assert.rejects(sendOnce({provider:f.provider,wallet:{address:CONFIG.owner,signTransaction:async()=>{signatures++;throw Error('signature boundary');}},plan:p,journalFile:file,refresh:()=>makeRepairPlan(f.provider,f),log:()=>{}}),/signature boundary/);assert.equal(signatures,1);assert.equal(f.broadcasts(),0);
 await assert.rejects(sendOnce({provider:f.provider,wallet:{address:CONFIG.owner,signTransaction:async()=>{throw Error('must not sign');}},plan:p,journalFile:file,refresh:async()=>({...await makeRepairPlan(f.provider,f),transaction:{...p.transaction,nonce:9}}),log:()=>{}}),/nonce changed/);assert.equal(f.broadcasts(),0);
});
test('recorded attempts cannot be repeated and unknown repair journals are rejected',async()=>{
 const f=setup(),p=await makeRepairPlan(f.provider,f),file=resolve('reports/network-quality/test-repair-existing-'+randomUUID()+'.json');await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,JSON.stringify({state:'broadcast_uncertain',txHash:'0x'+'aa'.repeat(32)}));
 await assert.rejects(sendOnce({provider:f.provider,wallet:{address:CONFIG.owner},plan:p,journalFile:file,refresh:()=>makeRepairPlan(f.provider,f),log:()=>{}}),/prior attempt/i);await assert.rejects(repairStatus(f.provider,{...f,file}),/Unrecognized/);await assert.rejects(requireFreshRepairAttempt(file),/already recorded.*--status/);await requireFreshRepairAttempt(file+'.absent');assert.equal(f.broadcasts(),0);
});
