// User-run only. Default retains all four existing intents and adds three.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Interface, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { CONFIG as BASE, RegistrationError, hiddenKey, sendOnce, readRecord, finishReceipt } from './register-miner.mjs';
import { readMiner } from './update-miner.mjs';
import { expandedDescriptor, UNIFIED_ORIGIN } from './render-expanded-miner.mjs';
export const CONFIG = Object.freeze({ ...BASE, owner: '0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3', oldId: 4844,
  oldUrl: UNIFIED_ORIGIN + '/referenceforge-unified.yaml', oldHash: '0x6c1d031c2cc64ad6a57db83c8bb18af5538ef9531df2872b11267ead929d349a' });
export const ABI = new Interface(['function updateMiner(uint256,string,bytes32,address,uint256,string[]) returns(uint256)', 'function isCanonicalIntent(string) view returns(bool)']);
const requireThat = (value, message) => { if (!value) throw new RegistrationError(message); };
const equal = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const sameList = (a,b) => [...a].sort().join('|') === [...b].sort().join('|');
const json = value => JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
export function targetFor(keepFx = true) {
  return { url: UNIFIED_ORIGIN + (keepFx?'/referenceforge-expanded.yaml':'/referenceforge-expanded-no-fx.yaml'),
    hash: keepFx?'0x95f0c102e41a72d569302a9664ce37e55ccfdce56762018e7f9f0e3823d1e197':'0xb1aa128c22c904ba6fef49f9d690f6d2f6b2596b5bda4a312a1b486d66c1fcef',
    intents: expandedDescriptor({keepFx}).semantics.supported_intents, keepFx };
}
async function fetchJsonBytes(url, fetchImpl) {
  const r = await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  requireThat(r.ok&&r.body,'Hosted descriptor/runtime or Telegraph node is unavailable. Nothing signed.');
  const reader=r.body.getReader(),parts=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;requireThat(size<=65536,'Unexpected hosted response size.');parts.push(Buffer.from(value));}}
  finally {await reader.cancel();}return Buffer.concat(parts);
}
export async function makePlan(provider,{keepFx=true,fetchImpl=fetch,weatherRecordReader=readRecord}={}) {
  requireThat(!(await weatherRecordReader(resolve(import.meta.dirname,'../reports/weather/terminal',CONFIG.owner.toLowerCase()+'.json'))),'A weather upgrade attempt is already recorded. Use node tools/upgrade-weather-miner.mjs --status; do not run the older expansion.');
  const target=targetFor(keepFx);
  requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Wrong network. Only Base Sepolia (84532) is allowed.');
  requireThat(await provider.getCode(CONFIG.contract)!=='0x','Registry code unavailable.');
  const bytes=await fetchJsonBytes(target.url,fetchImpl);
  requireThat('0x'+createHash('sha256').update(bytes).digest('hex')===target.hash,'Expanded hosted YAML hash changed. Nothing signed.');
  requireThat(JSON.stringify(JSON.parse(bytes.toString('utf8')))===JSON.stringify(expandedDescriptor({keepFx})),'Expanded descriptor differs from the reviewed original.');
  const health=JSON.parse((await fetchJsonBytes(UNIFIED_ORIGIN+'/health',fetchImpl)).toString('utf8'));
  requireThat(target.intents.every(i=>health.supported_intents?.includes(i)),'Runtime does not support the selected intents.');
  requireThat(health.rpc_configuration==='alchemy_account_plus_publicnode','Configure the Alchemy free app key first: node tools/configure-alchemy.mjs --interactive. Shared public RPCs failed edge checks; no intent update will be signed yet.');
  for(const [chain,id] of [['base','8453'],['base-sepolia','84532']]){
    const path='/wallet-balance?'+new URLSearchParams({chain,address:CONFIG.owner});
    const a=JSON.parse((await fetchJsonBytes(UNIFIED_ORIGIN+path,fetchImpl)).toString('utf8'));
    requireThat(a.intent==='WALLET_BALANCE_CHECK'&&a.verified_answer===true&&a.chain_id===id&&equal(a.address,CONFIG.owner)&&typeof a.score_value==='string'
      &&a.score_value===a.balance&&a.verification?.sources?.length===2,'Fresh two-operator wallet readiness check failed. Nothing signed.');
  }
  const lookupReady=JSON.parse((await fetchJsonBytes(UNIFIED_ORIGIN+'/tx?chain=base-sepolia&field=status&tx_hash=0x565719356bd6589078d7666a9fc250b0a26e318a9e83d8ea08710ead615084eb',fetchImpl)).toString('utf8'));
  requireThat(lookupReady.intent==='ONCHAIN_TX_LOOKUP'&&lookupReady.verified_answer===true&&lookupReady.score_value==='1'&&lookupReady.verification?.sources?.length===2,'Fresh transaction lookup readiness check failed. Nothing signed.');
  const converted=JSON.parse((await fetchJsonBytes(UNIFIED_ORIGIN+'/convert?base=EUR&quote=EUR&amount=2',fetchImpl)).toString('utf8'));
  requireThat(converted.intent==='CURRENCY_EXCHANGE'&&converted.score_value===converted.converted_amount&&converted.score_value==='2.000000000000'&&converted.source?.payload_sha256,'Fresh conversion readiness check failed. Nothing signed.');
  const old=await readMiner(provider,CONFIG.oldId);
  requireThat(old.active&&equal(old.owner,CONFIG.owner)&&old.url===CONFIG.oldUrl&&equal(old.hash,CONFIG.oldHash)
    &&equal(old.feeAddress,CONFIG.owner)&&old.minPriceUsdc===10000n&&sameList(old.intents,['FX_NOW','MACRO_ECONOMIC_INDICATOR','CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY']),
  'Miner 4844 changed or was already replaced. Inspect --status. No registration will be guessed or repeated.');
  for(const id of [4838,4843])requireThat(!(await readMiner(provider,id)).active,'Finish retiring the older miners before this expansion.');
  for(const intent of target.intents){const r=await provider.call({to:CONFIG.contract,data:ABI.encodeFunctionData('isCanonicalIntent',[intent])});requireThat(ABI.decodeFunctionResult('isCanonicalIntent',r)[0],intent+' is not canonical.');}
  const tx={from:CONFIG.owner,to:CONFIG.contract,value:0n,data:ABI.encodeFunctionData('updateMiner',[CONFIG.oldId,target.url,target.hash,CONFIG.owner,10000n,target.intents])};
  try{await provider.call(tx);}catch{throw new RegistrationError('Expanded update contract simulation failed. Nothing signed.');}
  const latest=await provider.getTransactionCount(CONFIG.owner,'latest'),pending=await provider.getTransactionCount(CONFIG.owner,'pending');
  requireThat(latest===pending,'Resolve the pending wallet transaction first.');
  const estimate=await provider.estimateGas(tx),gasLimit=(estimate*125n+99n)/100n,fee=await provider.getFeeData();
  requireThat(gasLimit>0n&&gasLimit<=2000000n&&fee.maxFeePerGas>0n&&fee.maxPriorityFeePerGas>=0n&&fee.maxPriorityFeePerGas<=fee.maxFeePerGas,'Unexpected gas or fee estimate.');
  const l2Cost=gasLimit*fee.maxFeePerGas,balance=await provider.getBalance(CONFIG.owner);
  requireThat(l2Cost<=CONFIG.maxL2Cost,'L2 fee ceiling exceeds 0.001 test ETH.');
  const approvedCost=l2Cost*2n<CONFIG.maxL2Cost?l2Cost*2n:CONFIG.maxL2Cost;
  return {checkedAt:new Date().toISOString(),operation:keepFx?'expand_to_seven_keep_fx_reference':'expand_to_six_replace_fx_reference',previousRegistrationId:CONFIG.oldId,
    account:CONFIG.owner,contract:CONFIG.contract,chainId:CONFIG.chainId,...target,feeAddress:CONFIG.owner,minPriceUsdc:10000n,
    transaction:{...tx,chainId:CONFIG.chainId,type:2,nonce:pending,gasLimit,maxFeePerGas:fee.maxFeePerGas,maxPriorityFeePerGas:fee.maxPriorityFeePerGas},
    balance,l2Cost,approvedCost,reserve:CONFIG.reserve,funded:balance>=approvedCost+CONFIG.reserve};
}
export async function status(provider,file,{fetchImpl=fetch}={}) {
  const prior=await readRecord(file);if(!prior){return {sentByThisHelper:false,current:await readMiner(provider,4844)};}
  const allowed=[targetFor(true),targetFor(false)].find(x=>x.url===prior.url&&equal(x.hash,prior.hash));
  requireThat(allowed&&equal(prior.account,CONFIG.owner),'Unexpected expansion journal. Stop and inspect.');
  const record=await finishReceipt(await provider.getTransactionReceipt(prior.txHash),prior,file);
  const result={record};
  if(record.registration?.registrationId){
    const id=record.registration.registrationId,miner=await readMiner(provider,id);result.current=miner;
    try{const node=JSON.parse((await fetchJsonBytes('https://devnode.telegraphprotocol.com/api/miners/'+id,fetchImpl)).toString('utf8')).miner;
      result.nodeActive=Boolean(miner.active&&equal(miner.owner,CONFIG.owner)&&equal(miner.hash,allowed.hash)&&sameList(miner.intents,allowed.intents)
        &&String(node?.registration_id)===id&&node.activation_status==='active'&&equal(node.miner_address,CONFIG.owner)&&node.yaml_url===allowed.url&&equal('0x'+node.yaml_hash.replace(/^0x/,''),allowed.hash)&&sameList(node.supported_intents,allowed.intents));
      result.nodeStatus=node?.activation_status??'unavailable';
    }catch{result.nodeActive=false;result.nodeStatus='unavailable_or_pending';}
  }return result;
}
export function argumentsFor(args){
  let mode,replace=false;
  for(const arg of args){if(arg==='--replace-fx-reference'){requireThat(!replace,'Duplicate replacement flag.');replace=true;continue;}
    requireThat(['--check','--status','--interactive'].includes(arg)&&!mode,'Use --check, --status or --interactive; optional --replace-fx-reference. Keys are never accepted as arguments.');mode=arg;}
  return {mode:mode??'--check',keepFx:!replace};
}
async function main(args){
  const {mode,keepFx}=argumentsFor(args),interactive=mode==='--interactive';
  requireThat(!interactive||process.stdin.isTTY&&process.stdout.isTTY,'Use your own normal terminal for hidden local key entry.');
  // Both variants share one attempt journal. Choosing another variant cannot evade it.
  const file=resolve(import.meta.dirname,'../reports/intent-expansion/terminal',CONFIG.owner.toLowerCase()+'-from-4844.json');
  const provider=new JsonRpcProvider(CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=3000;
  try{
    requireThat(BigInt(await provider.send('eth_chainId',[]))===CONFIG.chainId,'Wrong network.');
    if(mode==='--status'||await readRecord(file)){console.log(json(await status(provider,file)));console.log('No additional update sent.');return;}
    const preflight=()=>makePlan(provider,{keepFx}),plan=await preflight();
    console.log(json({network:'Base Sepolia (84532), TESTNET ONLY',updateFrom:4844,owner:plan.account,yamlUrl:plan.url,yamlSHA256:plan.hash,intents:plan.intents,
      retainedFX_NOW:keepFx,feeAddress:plan.feeAddress,floorPriceUSDC:'0.01',nonce:plan.transaction.nonce,balanceTestETH:formatEther(plan.balance),
      estimatedL2GasTestETH:formatEther(plan.l2Cost),approvedMaximumL2GasTestETH:formatEther(plan.approvedCost),additionalL1ReserveTestETH:formatEther(plan.reserve),funded:plan.funded,
      limitations:'Base/Base Sepolia wallet/transaction coverage only; no ENS or internal traces. ECB rates are daily references, not live institutional mid-market rates/spreads. More intents do not prove scores or earnings.',
      scope:'ONE updateMiner transaction replaces 4844 with a NEW registration ID. No fresh registerMiner, extra miner, retirement, WASM or USDC payment.'}));
    if(!interactive)return;requireThat(plan.funded,'More Base Sepolia test ETH is needed for gas and reserve. Nothing signed.');
    const token=keepFx?'EXPAND_REFERENCEFORGE_7':'EXPAND_REFERENCEFORGE_6',prompt=createInterface({input:process.stdin,output:process.stdout});let approved;
    try{approved=await prompt.question('Type '+token+' to approve this ONE update; anything else cancels: ')===token;}finally{prompt.close();}
    if(!approved)return;
    let key=(await hiddenKey()).trim(),wallet;
    try{requireThat(/^(0x)?[a-fA-F0-9]{64}$/.test(key),'Invalid private key format.');wallet=new Wallet(key.startsWith('0x')?key:'0x'+key);}finally{key='';}
    const result=await sendOnce({provider,wallet,plan,journalFile:file,lockFile:resolve(import.meta.dirname,'../reports/referenceforge-update.lock'),refresh:preflight});console.log(json(result));
    console.log('Check later: node tools/expand-miner.mjs --status');if(result.state!=='confirmed')process.exitCode=2;
  }finally{provider.destroy();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main(process.argv.slice(2));}catch(error){console.error(error instanceof RegistrationError?error.message:'Expansion stopped on an RPC or local operation error. No automatic retry. Use --status.');process.exitCode=1;}}
