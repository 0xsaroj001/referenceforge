// User-run signing only. Agent checks use --check or mock providers.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {JsonRpcProvider,Wallet,formatEther} from 'ethers';
import {CONFIG,ABI,targetFor} from './expand-miner.mjs';
import {readMiner} from './update-miner.mjs';
import {RegistrationError,hiddenKey,sendOnce,readRecord,finishReceipt} from './register-miner.mjs';
import {weatherDescriptor,UNIFIED_ORIGIN} from './render-weather-miner.mjs';
const requireThat=(ok,msg)=>{if(!ok)throw new RegistrationError(msg);},equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const same=(a,b)=>a.length===b.length&&[...a].sort().join('|')===[...b].sort().join('|');
export const TARGET=Object.freeze({url:UNIFIED_ORIGIN+'/referenceforge-weather.yaml',hash:'0xde4f29445f76a1679c832ab19f5d92eaf2e5c56f893528cad329d8fd59641e68',intents:weatherDescriptor().semantics.supported_intents});
export const FILE=resolve(import.meta.dirname,'../reports/weather/terminal',CONFIG.owner.toLowerCase()+'.json');
const EXPANSION_FILE=resolve(import.meta.dirname,'../reports/intent-expansion/terminal',CONFIG.owner.toLowerCase()+'-from-4844.json');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2);
async function bytes(url,fetchImpl){
  const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  requireThat(r.ok&&r.body,'Readiness failed at '+new URL(url).pathname+' (HTTP '+r.status+'). Nothing signed.');
  const reader=r.body.getReader(),parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;requireThat(size<=262144,'Unexpected readiness response size.');parts.push(Buffer.from(value));}}finally{await reader.cancel();}
  return Buffer.concat(parts);
}
export {bytes as readinessBytes};
export async function currentMiner(provider,{expansionRecord,expansionFile=EXPANSION_FILE}={}){
  const record=expansionRecord===undefined?await readRecord(expansionFile):expansionRecord;
  let id=4844,expected={url:CONFIG.oldUrl,hash:CONFIG.oldHash,intents:['FX_NOW','MACRO_ECONOMIC_INDICATOR','CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY']};
  if(record){
    const seven=targetFor(true);requireThat(equal(record.account,CONFIG.owner)&&equal(record.contract,CONFIG.contract)&&record.url===seven.url&&equal(record.hash,seven.hash)&&same(record.intents,seven.intents),'Unrecognized previous expansion journal. Inspect it before signing.');
    const receipt=await provider.getTransactionReceipt(record.txHash);requireThat(receipt,'Previous expansion receipt is unavailable. Nothing signed.');
    const reconciled=await finishReceipt(receipt,record,expansionFile);
    requireThat(reconciled.state==='confirmed'&&/^\d+$/.test(reconciled.registration?.registrationId??''),'Previous expansion is pending, uncertain or unverified. Resolve it; do not send another transaction.');
    id=Number(reconciled.registration.registrationId);requireThat(Number.isSafeInteger(id)&&id>0,'Invalid previous registration ID.');expected=seven;
  }
  const miner=await readMiner(provider,id);
  if(id!==4844)requireThat(!(await readMiner(provider,4844)).active,'The earlier four-intent miner is still active. Resolve the prior update.');
  requireThat(miner.active&&equal(miner.owner,CONFIG.owner)&&miner.url===expected.url&&equal(miner.hash,expected.hash)&&equal(miner.feeAddress,CONFIG.owner)&&miner.minPriceUsdc===10000n&&same(miner.intents,expected.intents),'Current registered miner differs from the reviewed four/seven-intent state. No ID will be guessed.');
  for(const old of [4838,4843])requireThat(!(await readMiner(provider,old)).active,'An older miner remains active; resolve consolidation first.');
  return miner;
}
export async function makeWeatherPlan(provider,{fetchImpl=fetch,expansionRecord,expansionFile}={}){
  requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Only Base Sepolia 84532 is allowed.');requireThat(await provider.getCode(CONFIG.contract)!=='0x','Registry code is missing.');
  const old=await currentMiner(provider,{expansionRecord,expansionFile}),d=await bytes(TARGET.url,fetchImpl);
  requireThat('0x'+createHash('sha256').update(d).digest('hex')===TARGET.hash&&JSON.stringify(JSON.parse(d))===JSON.stringify(weatherDescriptor()),'Hosted weather descriptor changed. Nothing signed.');
  const health=JSON.parse(await bytes(UNIFIED_ORIGIN+'/health',fetchImpl));requireThat(TARGET.intents.every(i=>health.supported_intents?.includes(i))&&health.rpc_configuration==='alchemy_account_plus_publicnode','Runtime or configured Alchemy readiness is incomplete.');
  for(const kind of ['forecast','current','alerts']){
    const a=JSON.parse(await bytes(UNIFIED_ORIGIN+'/weather/'+kind+'?lat=25.7617&lon=-80.1918',fetchImpl));
    requireThat(a.intent===({forecast:'WEATHER_FORECAST',current:'WEATHER_CHECK',alerts:'STORM_ALERT'})[kind]&&a.verified_answer===true&&typeof a.score_value==='string'&&a.sources?.every(s=>/^[a-f0-9]{64}$/.test(s.payload_sha256))&&a.sources.length>=2,'Fresh weather readiness is incomplete.');
  }
  for(const chain of ['base','base-sepolia']){
    const a=JSON.parse(await bytes(UNIFIED_ORIGIN+'/wallet-balance?'+new URLSearchParams({chain,address:CONFIG.owner}),fetchImpl));requireThat(a.verified_answer&&a.intent==='WALLET_BALANCE_CHECK'&&a.verification?.sources?.length===2,'Fresh two-source blockchain readiness failed.');
  }
  for(const intent of TARGET.intents){const r=await provider.call({to:CONFIG.contract,data:ABI.encodeFunctionData('isCanonicalIntent',[intent])});requireThat(ABI.decodeFunctionResult('isCanonicalIntent',r)[0],'Noncanonical intent '+intent);}
  const tx={from:CONFIG.owner,to:CONFIG.contract,value:0n,data:ABI.encodeFunctionData('updateMiner',[old.id,TARGET.url,TARGET.hash,CONFIG.owner,10000n,TARGET.intents])};
  try{await provider.call(tx);}catch{throw new RegistrationError('Ten-intent update simulation failed. Nothing signed.');}
  const latest=await provider.getTransactionCount(CONFIG.owner,'latest'),pending=await provider.getTransactionCount(CONFIG.owner,'pending');requireThat(latest===pending,'Wallet has a pending transaction. Nothing signed.');
  const gasLimit=((await provider.estimateGas(tx))*125n+99n)/100n,fee=await provider.getFeeData();
  requireThat(gasLimit>0n&&gasLimit<=2000000n&&fee.maxFeePerGas>0n&&fee.maxPriorityFeePerGas>=0n&&fee.maxPriorityFeePerGas<=fee.maxFeePerGas,'Unexpected gas terms.');
  const l2Cost=gasLimit*fee.maxFeePerGas,balance=await provider.getBalance(CONFIG.owner);requireThat(l2Cost<=CONFIG.maxL2Cost,'L2 fee ceiling exceeds 0.001 test ETH.');const approvedCost=l2Cost*2n<CONFIG.maxL2Cost?l2Cost*2n:CONFIG.maxL2Cost;
  return {checkedAt:new Date().toISOString(),operation:'upgrade_referenceforge_weather_ten',previousRegistrationId:old.id,account:CONFIG.owner,contract:CONFIG.contract,chainId:CONFIG.chainId,...TARGET,feeAddress:CONFIG.owner,minPriceUsdc:10000n,balance,l2Cost,approvedCost,reserve:CONFIG.reserve,funded:balance>=approvedCost+CONFIG.reserve,
    transaction:{...tx,chainId:CONFIG.chainId,type:2,nonce:pending,gasLimit,maxFeePerGas:fee.maxFeePerGas,maxPriorityFeePerGas:fee.maxPriorityFeePerGas}};
}
export async function weatherStatus(provider,{file=FILE,fetchImpl=fetch}={}){
  const prior=await readRecord(file);if(!prior)return {sentByThisHelper:false,current:await currentMiner(provider)};
  requireThat(equal(prior.account,CONFIG.owner)&&equal(prior.contract,CONFIG.contract)&&prior.url===TARGET.url&&equal(prior.hash,TARGET.hash)&&same(prior.intents,TARGET.intents),'Unexpected weather update journal. Stop and inspect.');
  const record=await finishReceipt(await provider.getTransactionReceipt(prior.txHash),prior,file),result={record};
  if(record.registration?.registrationId){const current=await readMiner(provider,Number(record.registration.registrationId));result.current=current;
    try{const n=JSON.parse(await bytes('https://devnode.telegraphprotocol.com/api/miners/'+current.id,fetchImpl)).miner;result.nodeActive=Boolean(current.active&&equal(current.hash,TARGET.hash)&&same(current.intents,TARGET.intents)&&n?.activation_status==='active'&&String(n.registration_id)===String(current.id)&&equal(n.miner_address,CONFIG.owner)&&n.yaml_url===TARGET.url&&equal('0x'+String(n.yaml_hash).replace(/^0x/,''),TARGET.hash)&&same(n.supported_intents,TARGET.intents));}catch{result.nodeActive=false;}
  }return result;
}
async function main(args){
  requireThat(args.length<=1&&(!args.length||['--check','--status','--interactive'].includes(args[0])),'Use --check, --status or --interactive. Never pass a private key as an argument.');
  const mode=args[0]??'--check';requireThat(mode!=='--interactive'||process.stdin.isTTY&&process.stdout.isTTY,'Use your own terminal for hidden local key entry.');
  const provider=new JsonRpcProvider(CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=3000;
  try{
    requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Wrong network.');
    if(mode==='--status'||await readRecord(FILE)){console.log(json(await weatherStatus(provider)));console.log('No additional update sent.');return;}
    const refresh=()=>makeWeatherPlan(provider),p=await refresh();
    console.log(json({network:'Base Sepolia 84532, TESTNET ONLY',updateFrom:p.previousRegistrationId,yamlUrl:p.url,yamlSHA256:p.hash,intents:p.intents,owner:p.account,feeAddress:p.feeAddress,floorPriceUSDC:'0.01',nonce:p.transaction.nonce,balanceTestETH:formatEther(p.balance),approvedMaximumL2GasTestETH:formatEther(p.approvedCost),additionalL1ReserveTestETH:formatEther(p.reserve),funded:p.funded,scope:'ONE updateMiner replaces the current registration and issues a new ID. One ReferenceForge miner, ten intents. Weather is US NWS land coverage only; no WASM, new independent miner or USDC payment.'}));
    if(mode!=='--interactive')return;requireThat(p.funded,'Insufficient Base Sepolia test ETH for gas and reserve. Nothing signed.');
    const prompt=createInterface({input:process.stdin,output:process.stdout});let approved;try{approved=await prompt.question('Type UPGRADE_REFERENCEFORGE_10 to approve this ONE update; anything else cancels: ')==='UPGRADE_REFERENCEFORGE_10';}finally{prompt.close();}if(!approved)return;
    let key=(await hiddenKey()).trim(),wallet;try{requireThat(/^(0x)?[a-fA-F0-9]{64}$/.test(key),'Invalid private key format.');wallet=new Wallet(key.startsWith('0x')?key:'0x'+key);}finally{key='';}
    const record=await sendOnce({provider,wallet,plan:p,journalFile:FILE,lockFile:resolve(import.meta.dirname,'../reports/referenceforge-update.lock'),refresh});console.log(json(record));console.log('Check activation: node tools/upgrade-weather-miner.mjs --status');if(record.state!=='confirmed')process.exitCode=2;
  }finally{provider.destroy();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main(process.argv.slice(2));}catch(e){console.error(e instanceof RegistrationError?e.message:'Weather upgrade stopped on a local/RPC error. No automatic retry. Use --status.');process.exitCode=1;}}
