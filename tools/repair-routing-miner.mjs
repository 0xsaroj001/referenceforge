// Owner-run ONE update of the verified newer two-intent registration. No registerMiner.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {JsonRpcProvider,Wallet,formatEther,Interface} from 'ethers';
import {CONFIG} from './expand-miner.mjs';
import {readMiner} from './update-miner.mjs';
import {TARGET} from './refine-routing-miner.mjs';
import {RegistrationError,hiddenKey,readRecord,sendOnce,finishReceipt} from './register-miner.mjs';
import {boundedText} from '../src/onchain/rpc.mjs';
import {routingDescriptor} from './render-routing-miner.mjs';
import {readinessBytes} from './upgrade-weather-miner.mjs';
export const REPAIR=Object.freeze({oldId:4864,priorId:4851,oldUrl:'https://referenceforge.0xsaroj001.workers.dev/miner.yaml',oldHash:'0x5a676c4d038e763647772510967de4b381b9e149ac1d93423ad68e8669b12752',oldIntents:['FX_NOW','MACRO_ECONOMIC_INDICATOR'],...TARGET});
export const ABI=new Interface(['function updateMiner(uint256,string,bytes32,address,uint256,string[]) returns(uint256)','function isCanonicalIntent(string) view returns(bool)']);
export const FILE=resolve(import.meta.dirname,'../reports/network-quality/terminal',CONFIG.owner.toLowerCase()+'-repair-from-4864.json');
export async function requireFreshRepairAttempt(file=FILE){requireThat(!await readRecord(file),'A repair attempt is already recorded. Use --status; no upload or new transaction.');}
const ORIGIN='https://referenceforge.0xsaroj001.workers.dev',NODE='https://devnode.telegraphprotocol.com';
const requireThat=(v,message)=>{if(!v)throw new RegistrationError(message);},equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&[...a].sort().join('|')===[...b].sort().join('|');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2);
async function read(url,fetchImpl,limit=1048576){const signal=AbortSignal.timeout(15000),r=await fetchImpl(url,{redirect:'error',signal});requireThat(r.ok,'Hosted runtime or node record unavailable; no signing.');return boundedText(r,limit,signal);}
export async function ownedRegistrations(fetchImpl=fetch){
 const d=JSON.parse(await read(NODE+'/miner-dispatcher/miners/address/'+CONFIG.owner.toLowerCase()+'/yamls',fetchImpl));
 requireThat(Array.isArray(d.yamls)&&d.yamls.length<=200&&Number(d.count)===d.yamls.length,'Incomplete wallet registration history.');
 const rows=d.yamls.filter(x=>equal(x.miner_address,CONFIG.owner)&&x.slug==='referenceforge-numeric');
 requireThat(rows.length>0&&rows.every(x=>Number.isSafeInteger(x.registration_id)&&x.registration_id>0),'Invalid owned registration IDs.');return rows.sort((a,b)=>a.registration_id-b.registration_id);
}
function matchMiner(m,url,hash,intents){return m.active&&equal(m.owner,CONFIG.owner)&&m.url===url&&equal(m.hash,hash)&&equal(m.feeAddress,CONFIG.owner)&&m.minPriceUsdc===10000n&&same(m.intents,intents);}
export async function makeRepairPlan(provider,{fetchImpl=fetch}={}){
 requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Only Base Sepolia 84532 is allowed.');requireThat(await provider.getCode(CONFIG.contract)!=='0x','Registry code missing.');
 requireThat(matchMiner(await readMiner(provider,REPAIR.oldId),REPAIR.oldUrl,REPAIR.oldHash,REPAIR.oldIntents),'4864 is changed, inactive or not the pinned two-intent registration. Use --status; do not guess an ID.');
 requireThat(matchMiner(await readMiner(provider,REPAIR.priorId),REPAIR.url,REPAIR.hash,REPAIR.intents),'Prior registration 4851 changed; stop and inspect.');
 const rows=await ownedRegistrations(fetchImpl),latest=rows.at(-1);requireThat(latest.registration_id===REPAIR.oldId&&latest.activation_status==='active'&&latest.yaml_url===REPAIR.oldUrl&&equal(String(latest.yaml_hash).replace(/^0x/,''),REPAIR.oldHash.slice(2)),'A different registration now holds the slug; no automatic repair or guessed update.');
 const n=JSON.parse(await read(NODE+'/api/miners/'+REPAIR.oldId,fetchImpl)).miner;
 requireThat(n?.activation_status==='active'&&Number(n.registration_id)===REPAIR.oldId&&equal(n.miner_address,CONFIG.owner)&&n.yaml_url===REPAIR.oldUrl&&equal(String(n.yaml_hash).replace(/^0x/,''),REPAIR.oldHash.slice(2))&&same(n.supported_intents,REPAIR.oldIntents),'Current node record is not the exact newer two-intent registration.');
 const bytes=await readinessBytes(REPAIR.url,fetchImpl);requireThat('0x'+createHash('sha256').update(bytes).digest('hex')===REPAIR.hash&&JSON.stringify(JSON.parse(bytes.toString('utf8')))===JSON.stringify(routingDescriptor()),'Pinned ten-intent routing artifact changed.');
 const health=JSON.parse(await read(ORIGIN+'/health',fetchImpl));
 const runtimeReady=health.version==='0.5.4'&&health.rpc_configuration==='alchemy_account_plus_publicnode'&&same(health.supported_intents,REPAIR.intents)&&health.routing_contract_version==='explicit_metrics_v1';
 for(const intent of REPAIR.intents){const r=await provider.call({to:CONFIG.contract,data:ABI.encodeFunctionData('isCanonicalIntent',[intent])});requireThat(ABI.decodeFunctionResult('isCanonicalIntent',r)[0],'Noncanonical intent '+intent);}
 const tx={from:CONFIG.owner,to:CONFIG.contract,value:0n,data:ABI.encodeFunctionData('updateMiner',[REPAIR.oldId,REPAIR.url,REPAIR.hash,CONFIG.owner,10000n,REPAIR.intents])};
 try{await provider.call(tx);}catch{throw new RegistrationError('Routing repair simulation failed.');}
 const latestNonce=await provider.getTransactionCount(CONFIG.owner,'latest'),pending=await provider.getTransactionCount(CONFIG.owner,'pending');requireThat(latestNonce===pending,'Pending wallet transaction; inspect before repair.');
 const gasLimit=((await provider.estimateGas(tx))*125n+99n)/100n,fee=await provider.getFeeData();requireThat(gasLimit>0n&&gasLimit<=2000000n&&fee.maxFeePerGas>0n&&fee.maxPriorityFeePerGas>=0n&&fee.maxPriorityFeePerGas<=fee.maxFeePerGas,'Unexpected gas terms.');
 const l2Cost=gasLimit*fee.maxFeePerGas,balance=await provider.getBalance(CONFIG.owner);requireThat(l2Cost<=CONFIG.maxL2Cost,'L2 gas exceeds 0.001 test ETH ceiling.');const approvedCost=l2Cost*2n<CONFIG.maxL2Cost?l2Cost*2n:CONFIG.maxL2Cost;
 return {checkedAt:new Date().toISOString(),operation:'repair_ten_intent_routing_from_4864',previousRegistrationId:REPAIR.oldId,account:CONFIG.owner,contract:CONFIG.contract,chainId:CONFIG.chainId,url:REPAIR.url,hash:REPAIR.hash,intents:[...REPAIR.intents],feeAddress:CONFIG.owner,minPriceUsdc:10000n,runtimeReady,publicRuntime:health.version,balance,l2Cost,approvedCost,reserve:CONFIG.reserve,funded:balance>=approvedCost+CONFIG.reserve,transaction:{...tx,chainId:CONFIG.chainId,type:2,nonce:pending,gasLimit,maxFeePerGas:fee.maxFeePerGas,maxPriorityFeePerGas:fee.maxPriorityFeePerGas}};
}
export async function verifyReplacement(provider,id,{fetchImpl=fetch}={}){
 requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Wrong network for replacement verification.');
 requireThat(Number.isSafeInteger(Number(id))&&Number(id)>REPAIR.oldId,'A confirmed new replacement ID is required.');
 const current=await readMiner(provider,Number(id)),old=await readMiner(provider,REPAIR.oldId);requireThat(matchMiner(current,REPAIR.url,REPAIR.hash,REPAIR.intents)&&!old.active,'Replacement chain metadata or old registration state does not match.');
 const rows=await ownedRegistrations(fetchImpl);requireThat(rows.at(-1).registration_id===Number(id)&&rows.at(-1).activation_status==='active','A different or not-yet-active registration holds the slug.');
 const n=JSON.parse(await read(NODE+'/api/miners/'+id,fetchImpl)).miner;requireThat(n?.activation_status==='active'&&Number(n.registration_id)===Number(id)&&equal(n.miner_address,CONFIG.owner)&&n.yaml_url===REPAIR.url&&equal(String(n.yaml_hash).replace(/^0x/,''),REPAIR.hash.slice(2))&&same(n.supported_intents,REPAIR.intents)&&equal(n.fee_address,CONFIG.owner)&&Number(n.min_price_usdc)===10000,'Replacement node activation is pending or does not match all ten intents.');
 const catalogue=JSON.parse(await read(NODE+'/api/miners?status=active&limit=2000',fetchImpl,3000000));requireThat(Array.isArray(catalogue),'Invalid live catalogue.');const entry=catalogue.find(x=>x.slug==='referenceforge-numeric'&&equal(x.wallet_address,CONFIG.owner));
 const paths=entry?.endpoints?.map(x=>x.path)??[];requireThat(entry?.activation_status==='active'&&entry.yaml_url===REPAIR.url&&same(entry.supported_intents,REPAIR.intents)&&routingDescriptor().endpoints.every(x=>paths.includes(x.path)),'The live catalogue has not adopted the complete routing contract.');
 return {current,nodeActive:true,catalogueComplete:true};
}
export async function repairStatus(provider,{fetchImpl=fetch,file=FILE}={}){
 requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Wrong network for repair status.');
 const record=await readRecord(file);if(!record)return {record:null,currentOld:await readMiner(provider,REPAIR.oldId),prior:await readMiner(provider,REPAIR.priorId),owned:(await ownedRegistrations(fetchImpl)).map(x=>({registration_id:x.registration_id,activation_status:x.activation_status,yaml_url:x.yaml_url,yaml_hash:x.yaml_hash}))};
 requireThat(equal(record.account,CONFIG.owner)&&equal(record.contract,CONFIG.contract)&&record.url===REPAIR.url&&equal(record.hash,REPAIR.hash)&&same(record.intents,REPAIR.intents)&&record.operation==='repair_ten_intent_routing_from_4864'&&Number(record.previousRegistrationId)===REPAIR.oldId,'Unrecognized repair journal; stop.');
 const reconciled=await finishReceipt(await provider.getTransactionReceipt(record.txHash),record,file),result={record:reconciled,nodeActive:false,catalogueComplete:false};
 if(reconciled.state==='confirmed'&&reconciled.registration?.registrationId){try{Object.assign(result,await verifyReplacement(provider,Number(reconciled.registration.registrationId),{fetchImpl}));}catch(e){result.activationMessage=e instanceof RegistrationError?e.message:'Node verification unavailable; no automatic transaction retry.';}}return result;
}
async function main(){const args=process.argv.slice(2),mode=args[0]??'--check';requireThat(args.length<=1&&['--check','--status','--interactive','--preflight'].includes(mode),'Use --check, --status, --preflight or --interactive; never key arguments.');requireThat(mode!=='--interactive'||process.stdin.isTTY&&process.stdout.isTTY,'Run signing in your own terminal.');const provider=new JsonRpcProvider(CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});try{
 if(mode==='--preflight')await requireFreshRepairAttempt();
 if(mode==='--status'||await readRecord(FILE)){console.log(json(await repairStatus(provider)));console.log('No additional transaction sent.');return;}
 const p=await makeRepairPlan(provider);console.log(json({network:'Base Sepolia 84532 TESTNET',updateFrom:REPAIR.oldId,priorSuperseded:REPAIR.priorId,owner:p.account,registry:p.contract,feeAddress:p.feeAddress,floorPriceUSDC:'0.01',reviewedAt:p.checkedAt,yamlUrl:p.url,sha256:p.hash,intents:p.intents,publicRuntime:p.publicRuntime,runtimeReady:p.runtimeReady,nonce:p.transaction.nonce,balanceTestETH:formatEther(p.balance),approvedMaximumL2GasTestETH:formatEther(p.approvedCost),additionalL1ReserveTestETH:formatEther(p.reserve),funded:p.funded,scope:'ONE updateMiner replaces 4864 with a new ID for the SAME ReferenceForge slug and all ten intents. No registerMiner, retirement, USDC transfer or WASM. Historical 4851 remains superseded.'}));if(mode!=='--interactive')return;
 requireThat(p.runtimeReady,'Deploy tested runtime 0.5.4 first. Nothing signed.');requireThat(p.funded,'Insufficient test ETH; nothing signed.');const prompt=createInterface({input:process.stdin,output:process.stdout});let approved;try{approved=await prompt.question('Type REPAIR_REFERENCEFORGE_4864 to approve this ONE update; anything else cancels: ')==='REPAIR_REFERENCEFORGE_4864';}finally{prompt.close();}if(!approved)return;
 let key=(await hiddenKey()).trim(),wallet;try{requireThat(/^(0x)?[a-fA-F0-9]{64}$/.test(key),'Invalid key format.');wallet=new Wallet(key.startsWith('0x')?key:'0x'+key);}finally{key='';}
 const refresh=async()=>{const next=await makeRepairPlan(provider);requireThat(next.runtimeReady,'Public runtime changed; stop before signing.');return next;};
 console.log(json(await sendOnce({provider,wallet,plan:p,journalFile:FILE,lockFile:resolve(import.meta.dirname,'../reports/referenceforge-update.lock'),refresh})));console.log(json(await repairStatus(provider)));console.log('Use --status while indexing catches up. Never send another update to fix a pending response.');
 }finally{provider.destroy();}}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(e){console.error(e instanceof RegistrationError?e.message:'Repair stopped on a local/RPC error. No automatic retry; use --status.');process.exitCode=1;}}
