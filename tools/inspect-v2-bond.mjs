// Read-only, pinned-block diagnostics. No signer, approval, faucet claim or broadcast.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AbiCoder,Interface,JsonRpcProvider,keccak256,toBeHex} from 'ethers';
import {V2_DEPLOYMENT} from './verify-v2-deployment.mjs';
import {v2Descriptor,V2_ORIGIN} from './render-v2-miner.mjs';

export const BOND_TOKEN='0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4';
export const BOND_ABI=new Interface([
  'function getMiner(uint256) view returns(address,string,bytes32,bool,bytes32,address,uint256,string[])',
  'function updateMiner(uint256,string,bytes32,address,uint256,string[])',
  'function machinaToken() view returns(address)',
  'function minerBondParams() view returns(uint256,uint256,uint256,uint256,uint256)',
  'function quoteMinerBond(uint256) view returns(uint256,uint256)',
  'function isCanonicalIntent(string) view returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function decimals() view returns(uint8)',
  'error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)',
  'error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)'
]);
const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const coder=AbiCoder.defaultAbiCoder();
export function bondSlots(owner=V2_DEPLOYMENT.owner,registry=V2_DEPLOYMENT.registry){
  return {balance:keccak256(coder.encode(['address','uint256'],[owner,0])),allowance:keccak256(coder.encode(['address','bytes32'],[registry,keccak256(coder.encode(['address','uint256'],[owner,1]))]))};
}
export function defaultBondTarget(){const descriptor=v2Descriptor(),bytes=JSON.stringify(descriptor,null,2)+'\n';return {yaml_url:V2_ORIGIN+'/referenceforge-v2.yaml',yaml_sha256:'0x'+createHash('sha256').update(bytes).digest('hex'),intents:[...descriptor.semantics.supported_intents],status:'local_generated_candidate_not_verified_hosted'};}
export function decodeBondError(error){
  const data=error?.data??error?.info?.error?.data;
  assert(typeof data==='string'&&/^0x[0-9a-fA-F]+$/.test(data),'Missing or unknown simulation revert data');
  const parsed=BOND_ABI.parseError(data);assert(parsed,'Unknown simulation custom error');
  return {name:parsed.name,account:parsed.args[0],available:parsed.args[1],needed:parsed.args[2],data};
}
function showSimulation(value){return value.ok?{ok:true,return_data:value.data}:{ok:false,error:value.error.name,account:value.error.account,available:String(value.error.available),needed:String(value.error.needed),revert_data:value.error.data};}
export async function inspectV2Bond({provider,target=defaultBondTarget()}={}){
  assert(provider,'Read-only RPC provider required');
  assert(target&&target.yaml_url===V2_ORIGIN+'/referenceforge-v2.yaml'&&/^0x[0-9a-f]{64}$/.test(target.yaml_sha256),'Unexpected candidate artifact');
  assert(Array.isArray(target.intents)&&target.intents.length===5&&new Set(target.intents).size===5&&target.intents.every(x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]*$/.test(x)),'Expected exactly five unique concrete candidate intents');
  const c=V2_DEPLOYMENT;assert(BigInt(await provider.send('eth_chainId',[]))===c.chainId,'Wrong chain; inspection stopped');
  const block=await provider.send('eth_blockNumber',[]);assert(/^0x[0-9a-f]+$/i.test(block),'Invalid pinned block');
  const call=async(to,data,overrides)=>provider.send('eth_call',[{to,data},block,...(overrides?[overrides]:[])]);
  const read=async(name,args=[],to=c.registry,overrides)=>BOND_ABI.decodeFunctionResult(name,await call(to,BOND_ABI.encodeFunctionData(name,args),overrides));
  const [miner,token,params,quote,native]=await Promise.all([read('getMiner',[c.registrationId]),read('machinaToken'),read('minerBondParams'),read('quoteMinerBond',[target.intents.length]),provider.send('eth_getBalance',[c.owner,block])]);
  assert(miner[3]&&equal(miner[0],c.owner)&&equal(miner[5],c.owner)&&miner[6]===10000n,'Imported miner ownership, active state, payout or floor changed');
  assert(equal(token[0],BOND_TOKEN),'MACHINA token changed; do not guess storage layout');
  const code=await provider.send('eth_getCode',[BOND_TOKEN,block]);assert(/^0x(?:[0-9a-f]{2})+$/i.test(code),'No token bytecode');
  const [balance,allowance,decimals,...canonical]=await Promise.all([read('balanceOf',[c.owner],BOND_TOKEN),read('allowance',[c.owner,c.registry],BOND_TOKEN),read('decimals',[],BOND_TOKEN),...target.intents.map(x=>read('isCanonicalIntent',[x]))]);
  assert(decimals[0]===18n,'Unexpected MACHINA decimals');assert(canonical.every(x=>x[0]===true),'Candidate contains a noncanonical intent');
  const tx={from:c.owner,to:c.registry,data:BOND_ABI.encodeFunctionData('updateMiner',[c.registrationId,target.yaml_url,target.yaml_sha256,c.owner,10000n,target.intents])};
  const simulate=async(overrides)=>{try{return {ok:true,data:await provider.send('eth_call',[tx,block,...(overrides?[overrides]:[])])};}catch(e){return {ok:false,error:decodeBondError(e)};}};
  const slots=bondSlots(),override=(bal,allow)=>({[BOND_TOKEN]:{stateDiff:{...(bal===null?{}:{[slots.balance]:toBeHex(bal,32)}),...(allow===null?{}:{[slots.allowance]:toBeHex(allow,32)})}}});
  // Verify inferred ERC20 storage slots using original token code before using them.
  const sentinel=123456789n;
  assert((await read('allowance',[c.owner,c.registry],BOND_TOKEN,override(null,sentinel)))[0]===sentinel,'Allowance slot not verified');
  assert((await read('balanceOf',[c.owner],BOND_TOKEN,override(sentinel,null)))[0]===sentinel,'Balance slot not verified');
  const actual=await simulate(),zeroAllowance=await simulate(override(null,0n));
  let needed=0n;
  if(!zeroAllowance.ok){const e=zeroAllowance.error;assert(e.name==='ERC20InsufficientAllowance'&&equal(e.account,c.registry)&&e.available===0n&&e.needed>0n,'Update did not expose a valid allowance delta');needed=e.needed;}
  assert(needed<=quote[1],'Observed update delta exceeds full quote; manual review required');
  if(!actual.ok){const e=actual.error;assert(e.needed===needed&&(e.name==='ERC20InsufficientAllowance'&&equal(e.account,c.registry)&&e.available===allowance[0]||e.name==='ERC20InsufficientBalance'&&equal(e.account,c.owner)&&e.available===balance[0]),'Actual revert disagrees with pinned token reads or measured delta');}
  const exactFunded=await simulate(override(needed,needed));assert(exactFunded.ok,'Exact funded and approved simulation failed');
  let shortAllowance=null,shortBalance=null;
  if(needed>0n){
    shortAllowance=await simulate(override(needed,needed-1n));shortBalance=await simulate(override(needed-1n,needed));
    assert(!shortAllowance.ok&&shortAllowance.error.name==='ERC20InsufficientAllowance'&&equal(shortAllowance.error.account,c.registry)&&shortAllowance.error.available===needed-1n&&shortAllowance.error.needed===needed,'Allowance boundary changed');
    assert(!shortBalance.ok&&shortBalance.error.name==='ERC20InsufficientBalance'&&equal(shortBalance.error.account,c.owner)&&shortBalance.error.available===needed-1n&&shortBalance.error.needed===needed,'Balance boundary changed');
  }
  const funded=balance[0]>=needed,approved=allowance[0]>=needed;
  assert(!actual.ok||funded&&approved,'Actual success disagrees with observed token requirements');
  return {checked_at:new Date().toISOString(),chain_id:String(c.chainId),block_number:String(BigInt(block)),registry:c.registry,registration_id:c.registrationId,current_intents:[...miner[7]],target,target_calldata:tx.data,token:{address:BOND_TOKEN,decimals:18,code_sha256:createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex')},bond_params:{first_usd_micro:String(params[0]),further_usd_micro:String(params[1]),later_usd_micro:String(params[2]),tier_boundary:String(params[3]),release_delay_seconds:String(params[4])},full_registration_quote:{usd_micro:String(quote[0]),machina_wei:String(quote[1])},observed_update_delta_machina_wei:String(needed),owner:{address:c.owner,machina_wei:String(balance[0]),allowance_wei:String(allowance[0]),sepolia_eth_wei:String(BigInt(native)),funded_for_delta:funded,approved_for_delta:approved},simulations:{actual:showSimulation(actual),zero_allowance:showSimulation(zeroAllowance),exact_balance_and_allowance:showSimulation(exactFunded),one_wei_short_allowance:shortAllowance&&showSimulation(shortAllowance),one_wei_short_balance:shortBalance&&showSimulation(shortBalance)},state_overrides:{read_only:true,token_code_replaced:false,slots_verified_with_original_token_getters:true,slots},owner_action:!funded?'Sign in to the existing Anjoman account at https://anjoman.ai/dashboard/faucet and obtain free test MACHINA for the registering owner. Faucet availability and eligibility are not verified.':!approved?'A separate owner-approved MACHINA allowance transaction is required before the owner update.':'Token preflight passes; hosted artifact, validation, gas ceiling and fresh owner review remain separate checks.',read_only:true,transaction_ready:false,scope:'Pinned-block original-contract eth_call only. Storage overrides are hypothetical balances and allowances and disappear after each call. No tokens were received, approved or transferred. No transaction was signed or broadcast. Does not verify hosted YAML, node validation, new admission, ranking or universal bond formula.'};
}
async function main(){assert(process.argv.length===2,'No CLI arguments or secrets accepted');const provider=new JsonRpcProvider(V2_DEPLOYMENT.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});try{const report=await inspectV2Bond({provider});await mkdir('reports/v2-bond',{recursive:true});await writeFile('reports/v2-bond/latest.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}finally{provider.destroy();}}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(e){console.error(e.message);process.exitCode=1;}}
