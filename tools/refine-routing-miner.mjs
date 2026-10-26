// Owner-run descriptor revision only. No payment authorization or autonomous signing.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {JsonRpcProvider,Wallet,formatEther} from 'ethers';
import {CONFIG,ABI} from './expand-miner.mjs';
import {TARGET as WEATHER,readinessBytes as bytes} from './upgrade-weather-miner.mjs';
import {readMiner} from './update-miner.mjs';
import {routingDescriptor} from './render-routing-miner.mjs';
import {RegistrationError,hiddenKey,readRecord,sendOnce,finishReceipt} from './register-miner.mjs';
const requireThat=(v,m)=>{if(!v)throw new RegistrationError(m);},same=(a,b)=>a.length===b.length&&[...a].sort().join('|')===[...b].sort().join('|'),equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const ORIGIN='https://referenceforge.0xsaroj001.workers.dev';
export const TARGET={url:ORIGIN+'/referenceforge-routing.yaml',hash:'0xd3c4ad5864771472bdf51d61930079d6fd4864c04746b7a07659cccb84f57a73',intents:routingDescriptor().semantics.supported_intents};
export const FILE=resolve(import.meta.dirname,'../reports/network-quality/terminal',CONFIG.owner.toLowerCase()+'-from-4850.json');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2);
export async function makeRoutingPlan(provider,{fetchImpl=fetch}={}){
  requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Only Base Sepolia 84532 is allowed.');requireThat(await provider.getCode(CONFIG.contract)!=='0x','Registry code missing.');
  const current=await readMiner(provider,4850);
  requireThat(current.active&&equal(current.owner,CONFIG.owner)&&current.url===WEATHER.url&&equal(current.hash,WEATHER.hash)&&same(current.intents,TARGET.intents)&&equal(current.feeAddress,CONFIG.owner)&&current.minPriceUsdc===10000n,'Registration 4850 changed, is inactive or was already replaced. Use --status; do not guess another ID.');
  for(const id of [4838,4843,4844])requireThat(!(await readMiner(provider,id)).active,'An older registration is still active. Nothing signed.');
  const raw=await bytes(TARGET.url,fetchImpl);requireThat('0x'+createHash('sha256').update(raw).digest('hex')===TARGET.hash&&JSON.stringify(JSON.parse(raw))===JSON.stringify(routingDescriptor()),'Pinned routing descriptor changed. Nothing signed.');
  const health=JSON.parse(await bytes(ORIGIN+'/health',fetchImpl));requireThat(health.routing_contract_version==='explicit_metrics_v1'&&health.rpc_configuration==='alchemy_account_plus_publicnode'&&TARGET.intents.every(i=>health.supported_intents?.includes(i)),'Explicit routing runtime or Alchemy is not ready.');
  for(const path of ['/onchain-metric/native-balance?chain=base-sepolia&address='+CONFIG.owner,'/onchain-metric/gas?chain=base-sepolia&tx_hash=0x83b18dedaa93772e3c2456a181bd1090be719c8494cc9b32008af51f46684b34']){
    const a=JSON.parse(await bytes(ORIGIN+path,fetchImpl));requireThat(a.intent==='ONCHAIN_METRIC_VERIFY'&&a.chain_id==='84532'&&a.verified_answer===true&&typeof a.score_value==='string'&&a.verification?.sources?.length===2&&(path.includes('/native-balance?')?a.metric==='native_balance'&&equal(a.address,CONFIG.owner):a.metric==='gas'&&a.tx_hash==='0x83b18dedaa93772e3c2456a181bd1090be719c8494cc9b32008af51f46684b34'),'Fresh explicit metric readiness failed.');
  }
  for(const intent of TARGET.intents){const r=await provider.call({to:CONFIG.contract,data:ABI.encodeFunctionData('isCanonicalIntent',[intent])});requireThat(ABI.decodeFunctionResult('isCanonicalIntent',r)[0],'Noncanonical intent '+intent);}
  const tx={from:CONFIG.owner,to:CONFIG.contract,value:0n,data:ABI.encodeFunctionData('updateMiner',[4850,TARGET.url,TARGET.hash,CONFIG.owner,10000n,TARGET.intents])};
  try{await provider.call(tx);}catch{throw new RegistrationError('Routing revision simulation failed. Nothing signed.');}
  const latest=await provider.getTransactionCount(CONFIG.owner,'latest'),pending=await provider.getTransactionCount(CONFIG.owner,'pending');requireThat(latest===pending,'Pending wallet transaction; inspect status first.');
  const gasLimit=((await provider.estimateGas(tx))*125n+99n)/100n,fee=await provider.getFeeData();requireThat(gasLimit>0n&&gasLimit<=2000000n&&fee.maxFeePerGas>0n&&fee.maxPriorityFeePerGas>=0n&&fee.maxPriorityFeePerGas<=fee.maxFeePerGas,'Unexpected gas terms.');
  const l2Cost=gasLimit*fee.maxFeePerGas,balance=await provider.getBalance(CONFIG.owner);requireThat(l2Cost<=CONFIG.maxL2Cost,'L2 fee ceiling exceeds 0.001 test ETH.');const approvedCost=l2Cost*2n<CONFIG.maxL2Cost?l2Cost*2n:CONFIG.maxL2Cost;
  return {checkedAt:new Date().toISOString(),operation:'refine_referenceforge_routing',previousRegistrationId:4850,chainId:CONFIG.chainId,contract:CONFIG.contract,account:CONFIG.owner,...TARGET,feeAddress:CONFIG.owner,minPriceUsdc:10000n,balance,l2Cost,approvedCost,reserve:CONFIG.reserve,funded:balance>=approvedCost+CONFIG.reserve,transaction:{...tx,chainId:CONFIG.chainId,type:2,nonce:pending,gasLimit,maxFeePerGas:fee.maxFeePerGas,maxPriorityFeePerGas:fee.maxPriorityFeePerGas}};
}
export async function routingStatus(provider,{fetchImpl=fetch,file=FILE}={}){
  const record=await readRecord(file);if(!record)return {sentByThisHelper:false,current:await readMiner(provider,4850)};
  requireThat(equal(record.account,CONFIG.owner)&&equal(record.contract,CONFIG.contract)&&record.url===TARGET.url&&equal(record.hash,TARGET.hash)&&same(record.intents,TARGET.intents),'Unrecognized routing journal. Stop and inspect.');
  const reconciled=await finishReceipt(await provider.getTransactionReceipt(record.txHash),record,file),result={record:reconciled};
  if(reconciled.registration?.registrationId){const id=Number(reconciled.registration.registrationId),current=await readMiner(provider,id);result.current=current;
    try{const node=JSON.parse(await bytes('https://devnode.telegraphprotocol.com/api/miners/'+id,fetchImpl)).miner;result.nodeActive=Boolean(current.active&&equal(current.owner,CONFIG.owner)&&current.url===TARGET.url&&equal(current.hash,TARGET.hash)&&same(current.intents,TARGET.intents)&&node?.activation_status==='active'&&Number(node.registration_id)===id&&equal(node.miner_address,CONFIG.owner)&&node.yaml_url===TARGET.url&&equal(String(node.yaml_hash).replace(/^0x/,''),TARGET.hash.slice(2))&&same(node.supported_intents,TARGET.intents));}catch{result.nodeActive=false;}
  }return result;
}
async function main(args){
  requireThat(args.length<=1&&(!args.length||['--check','--interactive','--status'].includes(args[0])),'Use --check, --interactive or --status. No key arguments.');const mode=args[0]??'--check';requireThat(mode!=='--interactive'||process.stdin.isTTY&&process.stdout.isTTY,'Use your own terminal for hidden key entry.');
  const provider=new JsonRpcProvider(CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=3000;
  try{requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Wrong network.');if(mode==='--status'||await readRecord(FILE)){console.log(json(await routingStatus(provider)));console.log('No additional update sent.');return;}
    const refresh=()=>makeRoutingPlan(provider),p=await refresh();console.log(json({network:'Base Sepolia 84532 TESTNET',updateFrom:4850,owner:p.account,yamlUrl:p.url,yamlSHA256:p.hash,intents:p.intents,feeAddress:p.feeAddress,floorPriceUSDC:'0.01',nonce:p.transaction.nonce,reviewedAt:p.checkedAt,balanceTestETH:formatEther(p.balance),approvedMaximumL2GasTestETH:formatEther(p.approvedCost),additionalL1ReserveTestETH:formatEther(p.reserve),funded:p.funded,scope:'ONE updateMiner replaces 4850 with a new ID. SAME ten intents and fee; separate required fields for five on-chain metrics. No extra miner, USDC payment, WASM, or guaranteed rescore.'}));
    if(mode!=='--interactive')return;requireThat(p.funded,'Insufficient Base Sepolia test ETH for gas and reserve.');const prompt=createInterface({input:process.stdin,output:process.stdout});let approved;try{approved=await prompt.question('Type REFINE_REFERENCEFORGE_ROUTING to approve this ONE update; anything else cancels: ')==='REFINE_REFERENCEFORGE_ROUTING';}finally{prompt.close();}if(!approved)return;
    let key=(await hiddenKey()).trim(),wallet;try{requireThat(/^(0x)?[a-fA-F0-9]{64}$/.test(key),'Invalid private key format.');wallet=new Wallet(key.startsWith('0x')?key:'0x'+key);}finally{key='';}
    console.log(json(await sendOnce({provider,wallet,plan:p,journalFile:FILE,lockFile:resolve(import.meta.dirname,'../reports/referenceforge-update.lock'),refresh})));console.log('Verify activation: node tools/refine-routing-miner.mjs --status');
  }finally{provider.destroy();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main(process.argv.slice(2));}catch(e){console.error(e instanceof RegistrationError?e.message:'Routing revision stopped on a local/RPC error. No automatic retry. Use --status.');process.exitCode=1;}}
