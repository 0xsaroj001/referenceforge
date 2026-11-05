import test from 'node:test';
import assert from 'node:assert/strict';
import {BOND_ABI,BOND_TOKEN,bondSlots,defaultBondTarget,decodeBondError,inspectV2Bond} from '../tools/inspect-v2-bond.mjs';
import {V2_DEPLOYMENT as c} from '../tools/verify-v2-deployment.mjs';

function fixture(options={}){
  const calls=[],slots=bondSlots(),needed=options.needed??17n;
  const provider={send:async(method,args)=>{
    calls.push({method,args});assert(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_call'].includes(method),'No mutations allowed');
    if(method==='eth_chainId')return options.wrongChain?'0x1':'0xaa36a7';
    if(method==='eth_blockNumber')return '0xa0';
    if(method==='eth_getBalance')return '0xb1a2bc2ec50000';
    if(method==='eth_getCode')return '0x6000';
    assert.equal(args[1],'0xa0','All state-dependent reads must use one fixed block');
    const [tx,,overrides]=args;assert(!overrides||!overrides[BOND_TOKEN].code,'Never replace token code');
    const state=overrides?.[BOND_TOKEN]?.stateDiff??{};
    const bal=state[slots.balance]!==undefined?BigInt(state[slots.balance]):options.balance??0n;
    const allow=state[slots.allowance]!==undefined?BigInt(state[slots.allowance]):options.allowance??0n;
    const parsed=BOND_ABI.parseTransaction(tx),name=parsed.name;
    const encode=values=>BOND_ABI.encodeFunctionResult(name,values);
    if(name==='getMiner')return encode([options.wrongOwner?'0x0000000000000000000000000000000000000001':c.owner,'https://example.com/old.yaml','0x'+'a'.repeat(64),true,'0x'+'0'.repeat(64),c.owner,10000n,['FX_NOW_CAD','FX_NOW_EUR','FX_NOW_SEK','MACRO_ECONOMIC_INDICATOR_GENERAL']]);
    if(name==='machinaToken')return encode([options.wrongToken?'0x0000000000000000000000000000000000000001':BOND_TOKEN]);
    if(name==='minerBondParams')return encode([1000000n,100000n,70000n,9n,172800n]);
    if(name==='quoteMinerBond')return encode([1400000n,100n]);
    if(name==='balanceOf')return encode([options.badSlots?0n:bal]);
    if(name==='allowance')return encode([options.badSlots?0n:allow]);
    if(name==='decimals')return encode([18]);
    if(name==='isCanonicalIntent')return encode([!options.noncanonical]);
    if(name==='updateMiner'){
      assert.equal(tx.from,c.owner);assert.equal(tx.to,c.registry);assert.deepEqual([...parsed.args[5]],defaultBondTarget().intents);
      if(options.unknownRevert)throw {data:'0x12345678'};
      const error=(name,values)=>{throw {data:BOND_ABI.encodeErrorResult(name,values)};};
      if(allow<needed)error('ERC20InsufficientAllowance',[c.registry,allow,needed]);
      if(bal<needed)error('ERC20InsufficientBalance',[c.owner,bal,needed]);
      return '0x'+'0'.repeat(60)+'12f0';
    }
    assert.fail('Unexpected read '+name);
  }};
  return {provider,calls};
}
test('exact five-pair delta is measured, not substituted with full registration quote',async()=>{
  const {provider,calls}=fixture(),r=await inspectV2Bond({provider});
  assert.equal(r.observed_update_delta_machina_wei,'17');assert.equal(r.full_registration_quote.machina_wei,'100');
  assert.equal(r.simulations.actual.error,'ERC20InsufficientAllowance');assert.equal(r.simulations.one_wei_short_balance.error,'ERC20InsufficientBalance');assert.equal(r.simulations.exact_balance_and_allowance.ok,true);
  assert.equal(r.transaction_ready,false);assert.equal(r.read_only,true);assert.equal(r.owner.funded_for_delta,false);
  assert.equal(r.owner.address,c.owner);
  assert.equal(r.target.intents.length,5);assert(calls.filter(x=>x.method==='eth_call'&&x.args.length===3).length>=6);
});
test('fresh funded and approved owner is still not declared registration-ready',async()=>{const {provider}=fixture({balance:30n,allowance:17n}),r=await inspectV2Bond({provider});assert(r.simulations.actual.ok);assert(r.owner.funded_for_delta);assert(r.owner.approved_for_delta);assert.equal(r.transaction_ready,false);});
test('funded but unapproved owner needs a separate approval',async()=>{const {provider}=fixture({balance:17n}),r=await inspectV2Bond({provider});assert(r.owner.funded_for_delta);assert(!r.owner.approved_for_delta);assert.match(r.owner_action,/separate owner-approved/);});
test('wrong chain stops before other reads',async()=>{const {provider,calls}=fixture({wrongChain:true});await assert.rejects(inspectV2Bond({provider}),/Wrong chain/);assert.equal(calls.length,1);});
for(const [name,options,pattern]of [['changed owner',{wrongOwner:true},/ownership/],['changed token',{wrongToken:true},/token changed/],['noncanonical pair',{noncanonical:true},/noncanonical/],['unverified storage layout',{badSlots:true},/slot not verified/],['delta above full quote',{needed:101n},/exceeds full quote/],['unknown custom error',{unknownRevert:true},/Unknown simulation/]])test(name+' refuses diagnosis',async()=>{const {provider}=fixture(options);await assert.rejects(inspectV2Bond({provider}),pattern);});
test('duplicate target intents refuse before network access',async()=>{const {provider,calls}=fixture(),target=defaultBondTarget();target.intents[1]=target.intents[0];await assert.rejects(inspectV2Bond({provider,target}),/unique concrete/);assert.equal(calls.length,0);});
test('missing revert data is never guessed',()=>assert.throws(()=>decodeBondError({message:'bad'}),/Missing or unknown/));
