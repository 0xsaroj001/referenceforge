// Read-only V2 deployment reconciliation. No signer, token approval or broadcast.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Interface,JsonRpcProvider} from 'ethers';
import {boundedText} from '../src/onchain/rpc.mjs';

export const V2_DEPLOYMENT=Object.freeze({
  chainId:11155111n,chainName:'Ethereum Sepolia',rpc:'https://ethereum-sepolia-rpc.publicnode.com',
  registry:'0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b',
  owner:'0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3',registrationId:4840,slug:'referenceforge-numeric',
  oldBaseRegistry:'0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8',
  source:'https://anjoman.ai/_next/static/chunks/1r3crs0mz8sgg.js',
  chainSource:'https://anjoman.ai/_next/static/chunks/1-20snm-xo6ki.js'
});
export const V2_READ_ABI=new Interface([
  'function getPrefixes() view returns(string[] prefixes,uint8[] kinds)',
  'function getCanonicalIntentsWithDescriptions() view returns(string[] intents,string[] descriptions)',
  'function getMiner(uint256) view returns(address owner,string yamlUrl,bytes32 yamlHash,bool active,bytes32 intentId,address feeAddress,uint256 minPriceUsdc,string[] supportedIntents)',
  'function quoteMinerBond(uint256) view returns(uint256 usd,uint256 machina)',
  'function machinaToken() view returns(address)','function usdcToken() view returns(address)',
  'function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'
]);
export const V2_UPDATE_SIGNATURE='updateMiner(uint256,string,bytes32,address,uint256,string[])';
const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const sorted=items=>[...items].sort();
function assertUniqueNames(names,label){assert(Array.isArray(names)&&names.length>0&&names.length<=1000&&names.every(n=>typeof n==='string'&&/^[A-Z][A-Z0-9_]*$/.test(n))&&new Set(names).size===names.length,'Invalid '+label);}
export function compareCanonicalSets(chain,node,interfaceNames){
  for(const [label,names]of [['chain list',chain],['node list',node],['interface list',interfaceNames]])assertUniqueNames(names,label);
  assert.deepEqual(sorted(chain),sorted(node),'Node canonical intents disagree with current chain');
  assert.deepEqual(sorted(chain),sorted(interfaceNames),'Anjoman canonical intents disagree with current chain');
  return createHash('sha256').update(JSON.stringify(sorted(chain))).digest('hex');
}
async function json(url,fetchImpl){const signal=AbortSignal.timeout(15000),r=await fetchImpl(url,{redirect:'error',signal});assert(r.ok,'Read-only source HTTP '+r.status);return JSON.parse(await boundedText(r,2000000,signal));}
export async function verifyV2Deployment({provider,fetchImpl=fetch,intentCount=5}={}){
  assert(provider,'Read-only provider required');assert(Number.isInteger(intentCount)&&intentCount>0&&intentCount<=200,'Invalid intent count');
  const cfg=V2_DEPLOYMENT;assert(BigInt(await provider.send('eth_chainId',[]))===cfg.chainId,'Wrong deployment chain; no automatic retargeting');
  const code=await provider.getCode(cfg.registry);assert(/^0x(?:[a-fA-F0-9]{2})+$/.test(code),'V2 registry has no code');
  const read=async(name,args=[],to=cfg.registry)=>V2_READ_ABI.decodeFunctionResult(name,await provider.call({to,data:V2_READ_ABI.encodeFunctionData(name,args)}));
  const [canonical,prefixes,miner,bond,usdc,machina]=await Promise.all([read('getCanonicalIntentsWithDescriptions'),read('getPrefixes'),read('getMiner',[cfg.registrationId]),read('quoteMinerBond',[intentCount]),read('usdcToken'),read('machinaToken')]);
  const chainNames=[...canonical[0]],prefixNames=[...prefixes[0]];assertUniqueNames(prefixNames,'prefix list');assert(prefixNames.length===prefixes[1].length&&canonical[0].length===canonical[1].length,'Inconsistent on-chain catalog arrays');
  assert(!chainNames.some(n=>prefixNames.includes(n)),'A family prefix was returned as a concrete intent');
  const ownerLower=cfg.owner.toLowerCase(),[node,ui,history,entry]=await Promise.all([
    json('https://devnode.telegraphprotocol.com/engine/v1/intents',fetchImpl),json('https://anjoman.ai/api/explorer/canonical-intents',fetchImpl),
    json('https://devnode.telegraphprotocol.com/miner-dispatcher/miners/address/'+ownerLower+'/yamls',fetchImpl),json('https://devnode.telegraphprotocol.com/api/miners/'+cfg.registrationId,fetchImpl)
  ]);
  assert(Array.isArray(node.intents)&&Number(node.count)===node.intents.length&&Number(node.canonical_on_chain)===node.intents.length,'Incomplete node intent discovery');
  assert(Array.isArray(ui.intents),'Invalid Anjoman chain-backed discovery');const canonicalHash=compareCanonicalSets(chainNames,node.intents.map(i=>i.intent_id),ui.intents.map(i=>i.name));
  assert(Array.isArray(history.yamls)&&history.yamls.length<=200&&Number(history.count)===history.yamls.length,'Incomplete owned registration history');
  const owned=history.yamls.filter(x=>equal(x.miner_address,cfg.owner)&&x.slug===cfg.slug).sort((a,b)=>a.registration_id-b.registration_id),active=owned.filter(x=>x.activation_status==='active');
  assert(active.length===1&&Number(active[0].registration_id)===cfg.registrationId&&Number(owned.at(-1)?.registration_id)===cfg.registrationId,'Owned imported registration changed; inspect instead of guessing an ID');
  const n=entry.miner;assert(miner[3]&&equal(miner[0],cfg.owner)&&equal(miner[5],cfg.owner),'Chain miner inactive or owner/payout changed');
  assert(n&&n.activation_status==='active'&&n.slug===cfg.slug&&equal(n.miner_address,miner[0])&&n.yaml_url===miner[1]&&equal(String(n.yaml_hash).replace(/^0x/,''),miner[2].slice(2)),'Indexed miner differs from current chain');
  assert.deepEqual(sorted([...miner[7]]),sorted(n.supported_intents),'Indexed miner intents differ from chain');assert([...miner[7]].every(i=>chainNames.includes(i)),'Imported miner has noncanonical intents');
  assert(bond[0]>=0n&&bond[1]>=0n,'Invalid bond quote');
  const [balance,allowance,nativeBalance]=await Promise.all([read('balanceOf',[cfg.owner],machina[0]),read('allowance',[cfg.owner,cfg.registry],machina[0]),provider.getBalance(cfg.owner)]);
  return {checked_at:new Date().toISOString(),verification:'chain_and_two_official_HTTP_catalogues_agree',chain_id:String(cfg.chainId),chain_name:cfg.chainName,registry:cfg.registry,registry_code_sha256:createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex'),canonical_intent_count:chainNames.length,canonical_names_sha256:canonicalHash,prefix_count:prefixNames.length,registration:{id:cfg.registrationId,slug:cfg.slug,owner:miner[0],active:miner[3],yaml_url:miner[1],yaml_sha256:miner[2],fee_address:miner[5],floor_usdc_micro:String(miner[6]),concrete_intents:[...miner[7]]},tokens:{usdc:usdc[0],machina:machina[0]},bond:{quoted_intent_count:intentCount,usd_micro:String(bond[0]),machina_wei:String(bond[1]),owner_machina_wei:String(balance[0]),allowance_wei:String(allowance[0]),owner_native_wei:String(nativeBalance),full_quote_funded:balance[0]>=bond[1],full_quote_approved:allowance[0]>=bond[1],note:'A read-only full bond quote is not a verified update delta. No approval or token purchase is performed.'},update_function_signature:V2_UPDATE_SIGNATURE,read_only:true,transaction_ready:false,scope:'Current deployment/catalogue/imported-identity reconciliation. Not descriptor conformance, model quality, new admission, update funding approval, signing or broadcast.'};
}
async function main(){const args=process.argv.slice(2);assert(args.length===0||args.length===2&&args[0]==='--intent-count'&&/^\d+$/.test(args[1]),'Use no arguments or --intent-count N; no keys, accounts or RPC overrides');const provider=new JsonRpcProvider(V2_DEPLOYMENT.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});try{const report=await verifyV2Deployment({provider,intentCount:args.length?Number(args[1]):5});await mkdir('reports/v2-deployment',{recursive:true});await writeFile('reports/v2-deployment/latest.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}finally{provider.destroy();}}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(e){console.error(e.message);process.exitCode=1;}}
