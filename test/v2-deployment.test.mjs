import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyV2Deployment,compareCanonicalSets,V2_DEPLOYMENT as C,V2_READ_ABI as ABI} from '../tools/verify-v2-deployment.mjs';
const names=['FX_NOW_CAD','MACRO_ECONOMIC_INDICATOR_GENERAL'];
function fixture(mutate=()=>{}){
  const state={chainId:C.chainId,code:'0x0102',owner:C.owner,active:true,id:C.registrationId,nodeNames:[...names],uiNames:[...names],tokenBalance:0n};mutate(state);
  const miner=[state.owner,'https://provider.test/miner.yaml','0x'+'ab'.repeat(32),state.active,'0x'+'00'.repeat(32),C.owner,10000n,names];
  const provider={async send(){return '0x'+state.chainId.toString(16);},async getCode(){return state.code;},async getBalance(){return 500000n;},async call(tx){const parsed=ABI.parseTransaction(tx),fn=parsed.name;
    const values={getCanonicalIntentsWithDescriptions:[names,['CAD','Unemployment']],getPrefixes:[['FX_NOW','MACRO_ECONOMIC_INDICATOR'],[0,0]],getMiner:miner,quoteMinerBond:[1400000n,1760000000000000000n],usdcToken:['0x'+'11'.repeat(20)],machinaToken:['0x'+'22'.repeat(20)],balanceOf:[state.tokenBalance],allowance:[0n]};return ABI.encodeFunctionResult(fn,values[fn]);}};
  const fetchImpl=async url=>Response.json(url.includes('/address/')?{count:1,yamls:[{miner_address:C.owner,slug:C.slug,activation_status:'active',registration_id:state.id}]}:url.endsWith('/'+C.registrationId)?{miner:{activation_status:'active',slug:C.slug,miner_address:miner[0],yaml_url:miner[1],yaml_hash:miner[2],supported_intents:names}}:url.includes('/api/explorer/')?{intents:state.uiNames.map(name=>({name}))}:{count:state.nodeNames.length,canonical_on_chain:state.nodeNames.length,intents:state.nodeNames.map(intent_id=>({intent_id}))});
  return {provider,fetchImpl};
}
test('deployment verifier reconciles pinned Sepolia identity without a signer or funded-bond claim',async()=>{
  const r=await verifyV2Deployment(fixture());assert.equal(r.chain_id,'11155111');assert.equal(r.registration.id,4840);assert.equal(r.transaction_ready,false);assert.equal(r.read_only,true);assert.equal(r.bond.full_quote_funded,false);
});
for(const [label,mutate]of [['wrong chain',s=>s.chainId=84532n],['no registry code',s=>s.code='0x'],['changed owner',s=>s.owner='0x'+'33'.repeat(20)],['inactive import',s=>s.active=false],['changed current ID',s=>s.id=4864],['node catalog drift',s=>s.nodeNames=['FX_NOW_CAD']],['UI catalog drift',s=>s.uiNames=['FX_NOW_CAD']]])test('deployment verifier refuses '+label,async()=>{await assert.rejects(verifyV2Deployment(fixture(mutate)));});
test('catalog verifier refuses duplicates and family substitution',()=>{assert.throws(()=>compareCanonicalSets(names,[...names,names[0]],names));assert.throws(()=>compareCanonicalSets(names,['FX_NOW',names[1]],names));assert.equal(compareCanonicalSets(names,[...names].reverse(),names).length,64);});
