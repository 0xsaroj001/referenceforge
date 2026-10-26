import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWeatherPlan,currentMiner,TARGET} from '../tools/upgrade-weather-miner.mjs';
import {CONFIG,ABI,targetFor} from '../tools/expand-miner.mjs';
import {ABI as REGISTRY} from '../tools/update-miner.mjs';
import {weatherDescriptor} from '../tools/render-weather-miner.mjs';
import {mkdtemp,rmdir,unlink,mkdir} from 'node:fs/promises';
import {sendOnce,refreshReviewed,RegistrationError,ABI as EVENTS} from '../tools/register-miner.mjs';
await mkdir("reports/weather",{recursive:true});
const existing=['FX_NOW','MACRO_ECONOMIC_INDICATOR','CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY'];
function fixture({changed={},noncanonical,pending=6,lowBalance=false}={}){
  let simulations=0;
  const provider={send:async()=> '0x14a34',getCode:async()=> '0x1234',call:async tx=>{
    const selector=tx.data.slice(0,10);
    if(selector===REGISTRY.getFunction('getMiner').selector){const id=Number(REGISTRY.decodeFunctionData('getMiner',tx.data)[0]);return REGISTRY.encodeFunctionResult('getMiner',[changed.owner??CONFIG.owner,changed.url??CONFIG.oldUrl,changed.hash??CONFIG.oldHash,id===4844&&!changed.inactive,'0x'+'11'.repeat(32),CONFIG.owner,changed.price??10000n,existing]);}
    if(selector===ABI.getFunction('isCanonicalIntent').selector)return ABI.encodeFunctionResult('isCanonicalIntent',[ABI.decodeFunctionData('isCanonicalIntent',tx.data)[0]!==noncanonical]);
    simulations++;return ABI.encodeFunctionResult('updateMiner',[7000]);
  },getTransactionCount:async(_,tag)=>tag==='pending'?pending:6,estimateGas:async()=>500000n,getFeeData:async()=>({maxFeePerGas:2000000n,maxPriorityFeePerGas:1000000n}),getBalance:async()=>lowBalance?0n:1000000000000000000n};
  const fetchImpl=async url=>{
    const p=new URL(url).pathname;
    if(url===TARGET.url)return new Response(JSON.stringify(weatherDescriptor(),null,2)+'\n');
    if(p==='/health')return Response.json({supported_intents:TARGET.intents,rpc_configuration:'alchemy_account_plus_publicnode'});
    if(p==='/wallet-balance')return Response.json({verified_answer:true,intent:'WALLET_BALANCE_CHECK',verification:{sources:[{},{}]}});
    const kind=p.split('/').at(-1);return Response.json({intent:({forecast:'WEATHER_FORECAST',current:'WEATHER_CHECK',alerts:'STORM_ALERT'})[kind],verified_answer:true,score_value:'source-backed example',sources:[{payload_sha256:'1'.repeat(64)},{payload_sha256:'2'.repeat(64)}]});
  };return {provider,fetchImpl,simulations:()=>simulations};
}
test('weather update retains the seven-intent foundation and pins one ten-intent update from verified 4844',async()=>{
  const f=fixture(),p=await makeWeatherPlan(f.provider,{fetchImpl:f.fetchImpl,expansionRecord:null});const d=ABI.decodeFunctionData('updateMiner',p.transaction.data);
  assert.equal(d[0],4844n);assert.equal(d[1],TARGET.url);assert.equal(d[2],TARGET.hash);assert.equal(d[3],CONFIG.owner);assert.equal(d[4],10000n);assert.deepEqual([...d[5]],TARGET.intents);assert.equal(p.transaction.value,0n);assert.equal(p.transaction.chainId,84532n);assert.equal(f.simulations(),1);assert.equal(p.funded,true);
});
test('weather plans contain the timestamp required by the refresh-before-signing safeguard',async()=>{
  const f=fixture(),options={fetchImpl:f.fetchImpl,expansionRecord:null};
  const reviewed=await makeWeatherPlan(f.provider,options),current=await makeWeatherPlan(f.provider,options);
  assert(Number.isFinite(Date.parse(reviewed.checkedAt)));assert.doesNotThrow(()=>refreshReviewed(reviewed,current));
  const missing={...reviewed};delete missing.checkedAt;assert.throws(()=>refreshReviewed(missing,current),/timestamp is missing/);
  assert.throws(()=>refreshReviewed({...reviewed,checkedAt:new Date(Date.now()-601000).toISOString()},current),/Review expired/);
  assert.throws(()=>refreshReviewed(reviewed,{...current,l2Cost:reviewed.approvedCost+1n}),/gas exceeds/);
  assert.throws(()=>refreshReviewed(reviewed,{...current,funded:false}),/funding is insufficient/);
  assert.throws(()=>refreshReviewed(reviewed,{...current,transaction:{...current.transaction,nonce:7}}),/nonce changed/);
});
test('real weather plan survives refresh and reaches a mock signer without broadcasting',async()=>{
  const f=fixture(),options={fetchImpl:f.fetchImpl,expansionRecord:null},plan=await makeWeatherPlan(f.provider,options);
  const dir=await mkdtemp('reports/weather/signing-gate-test-');let signs=0,broadcasts=0;
  f.provider.broadcastTransaction=async()=>{broadcasts++;throw Error('must not broadcast');};
  const wallet={address:CONFIG.owner,signTransaction:async()=>{signs++;throw new RegistrationError('mock signer boundary reached');}};
  await assert.rejects(sendOnce({provider:f.provider,wallet,plan,journalFile:dir+'/attempt.json',refresh:()=>makeWeatherPlan(f.provider,options)}),/mock signer boundary reached/);
  assert.equal(signs,1);assert.equal(broadcasts,0);await rmdir(dir);
});
test('weather update blocks changed ownership, hash, fee, inactive source, pending nonce and noncanonical intent',async()=>{
  for(const options of [{changed:{owner:'0x'+'22'.repeat(20)}},{changed:{hash:'0x'+'00'.repeat(32)}},{changed:{price:20000n}},{changed:{inactive:true}},{pending:7},{noncanonical:'STORM_ALERT'}]){
    const f=fixture(options);await assert.rejects(makeWeatherPlan(f.provider,{fetchImpl:f.fetchImpl,expansionRecord:null}));
  }
});
test('weather update blocks altered hosted bytes, unavailable weather and missing Alchemy configuration',async()=>{
  for(const alter of [url=>url===TARGET.url?new Response('changed'):null,url=>url.includes('/weather/current?')?Response.json({verified_answer:false}):null,url=>url.endsWith('/health')?Response.json({supported_intents:TARGET.intents,rpc_configuration:'shared_public_rpcs'}):null]){
    const f=fixture();await assert.rejects(makeWeatherPlan(f.provider,{expansionRecord:null,fetchImpl:async url=>alter(url)??f.fetchImpl(url)}));assert.equal(f.simulations(),0);
  }
});
test('weather update distinguishes unfunded plans and never assumes an uncertain prior expansion completed',async()=>{
  const f=fixture({lowBalance:true}),p=await makeWeatherPlan(f.provider,{fetchImpl:f.fetchImpl,expansionRecord:null});assert.equal(p.funded,false);
  await assert.rejects(currentMiner(f.provider,{expansionRecord:{account:CONFIG.owner,contract:CONFIG.contract,url:'https://unreviewed.example',hash:TARGET.hash,intents:TARGET.intents}}),/Unrecognized/);
});
test('shared wallet update lock excludes concurrent old/new helper broadcasts',async()=>{
  const dir=await mkdtemp('reports/weather/lock-test-'),lockFile=dir+'/shared.lock';let release,notify,signs=0;const acquired=new Promise(r=>notify=r),gate=new Promise(r=>release=r);
  const plan={account:CONFIG.owner,funded:true},wallet={address:CONFIG.owner,signTransaction:async()=>{signs++;throw Error('must not sign');}};
  const first=sendOnce({provider:{},wallet,plan,journalFile:dir+'/first.json',lockFile,refresh:async()=>{notify();await gate;throw new RegistrationError('cancelled test');}});
  const rejected=assert.rejects(first,/cancelled test/);await acquired;
  await assert.rejects(sendOnce({provider:{},wallet,plan,journalFile:dir+'/second.json',lockFile,refresh:async()=>plan}),/lock/);
  release();await rejected;assert.equal(signs,0);await rmdir(dir);
});
test('a verified prior seven-intent receipt selects its new registration; missing receipt blocks it',async()=>{
  const f=fixture(),seven=targetFor(true),record={account:CONFIG.owner,contract:CONFIG.contract,url:seven.url,hash:seven.hash,intents:seven.intents,state:'pending',txHash:'0x'+'44'.repeat(32)};
  const event=EVENTS.encodeEventLog(EVENTS.getEvent('IntentRegistered'),[7001,CONFIG.owner,0,'0x'+'11'.repeat(32),seven.url,seven.hash]);
  const receipt={status:1,hash:record.txHash,from:CONFIG.owner,to:CONFIG.contract,blockNumber:1,logs:[{address:CONFIG.contract,...event}]};
  const call=f.provider.call;
  f.provider.call=async tx=>{if(tx.data.startsWith(REGISTRY.getFunction('getMiner').selector)){const id=Number(REGISTRY.decodeFunctionData('getMiner',tx.data)[0]);return REGISTRY.encodeFunctionResult('getMiner',[CONFIG.owner,seven.url,seven.hash,id===7001,'0x'+'11'.repeat(32),CONFIG.owner,10000n,seven.intents]);}return call(tx);};
  f.provider.getTransactionReceipt=async()=>receipt;const dir=await mkdtemp('reports/weather/receipt-test-'),file=dir+'/prior.json';
  const p=await makeWeatherPlan(f.provider,{fetchImpl:f.fetchImpl,expansionRecord:record,expansionFile:file});assert.equal(p.previousRegistrationId,7001);assert.equal(ABI.decodeFunctionData('updateMiner',p.transaction.data)[0],7001n);
  f.provider.getTransactionReceipt=async()=>null;await assert.rejects(currentMiner(f.provider,{expansionRecord:record,expansionFile:file}),/receipt is unavailable/);await unlink(file);await rmdir(dir);
});
