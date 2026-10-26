import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { networksForEnv } from '../src/onchain/input.mjs';
import { createUnifiedWorker } from '../deploy/unified-worker.mjs';
import { validateAlchemyKey, checkKey, configure } from '../tools/configure-alchemy.mjs';
import { hiddenKey } from '../tools/register-miner.mjs';
import { createRpcSession } from '../src/onchain/rpc.mjs';
const key='public-fixture-api-key-not-a-real-credential';
test('Alchemy secret replaces one service on each network while preserving the other operator',()=>{
  const publicNetworks=networksForEnv(),configured=networksForEnv({ALCHEMY_API_KEY:key});
  for(const [name,host] of [['base','base-mainnet'],['base-sepolia','base-sepolia']]){
    assert.equal(configured[name].providers[0].url,`https://${host}.g.alchemy.com/v2`);assert.equal(configured[name].providers[0].headers.Authorization,'Bearer '+key);assert.equal(configured[name].providers[0].operator,'Alchemy account RPC');
    assert.deepEqual(configured[name].providers[1],publicNetworks[name].providers[1]);assert.equal(publicNetworks[name].providers[0].operator,'dRPC public RPC');
  }
  assert.throws(()=>networksForEnv({ALCHEMY_API_KEY:'https://example.com/secret'}),{code:'RPC_CONFIGURATION'});
});
test('API setup rejects wallet keys, seed phrases and URLs before checking or uploading',async()=>{
  for(const value of ['0x'+'11'.repeat(32),'11'.repeat(32),'seed words are not an app api key','https://example.com/key','short'])assert.throws(()=>validateAlchemyKey(value));
  let checked=0,uploaded=0;await assert.rejects(configure('0x'+'11'.repeat(32),{check:async()=>{checked++;},upload:async()=>{uploaded++;},log:()=>{}}));assert.equal(checked,0);assert.equal(uploaded,0);
});
test('API setup checks both network IDs and canonical reads with read-only methods only',async()=>{
  const methods=[],urls=[];
  await checkKey(key,{fetchImpl:async(url,options)=>{
    urls.push(url);assert(!url.includes(key));assert.equal(options.headers.Authorization,'Bearer '+key);const [{method,params}]=JSON.parse(options.body);methods.push(method);
    const result=method==='eth_chainId'?(url.includes('base-mainnet')?'0x2105':'0x14a34'):method==='eth_getBlockByNumber'?{hash:'0x'+'ab'.repeat(32)}:'0x0';
    if(method==='eth_getBalance')assert.equal(params[1].requireCanonical,true);
    return Response.json([{jsonrpc:'2.0',id:1,result}]);
  }});
  assert.equal(methods.length,6);assert(methods.every(m=>['eth_chainId','eth_getBlockByNumber','eth_getBalance'].includes(m)));assert(urls.some(x=>x.includes('base-sepolia')));
  await assert.rejects(checkKey(key,{fetchImpl:async()=>Response.json([{jsonrpc:'2.0',id:1,result:'0x1'}])}),/wrong network/);
});
test('RPC credentials remain in headers and never enter evidence or diagnostic logs',async()=>{
  const network=networksForEnv({ALCHEMY_API_KEY:key}).base,errors=[];
  const rpc=createRpcSession(network,{onRpcError:e=>errors.push(e),fetchImpl:async(url,options)=>{
    assert(!url.includes(key));if(url.includes('alchemy')){assert.equal(options.headers.Authorization,'Bearer '+key);return new Response('denied',{status:401});}
    return Response.json([{jsonrpc:'2.0',id:1,result:'0x2105'}]);
  }});
  await assert.rejects(rpc.both([{method:'eth_chainId'}]),{code:'RPC_UNAVAILABLE'});assert(!JSON.stringify(errors).includes(key));assert(!JSON.stringify(rpc.evidence).includes(key));
});
test('API setup cannot upload before its full preflight; it never logs the key',async()=>{
  const events=[],logs=[];
  await configure(key,{check:async()=>{events.push('check');},upload:async()=>{events.push('upload');},log:x=>logs.push(x)});assert.deepEqual(events,['check','upload']);assert(!logs.join('\n').includes(key));
  let uploaded=false;await assert.rejects(configure(key,{check:async()=>{throw new Error('fixture validation failure');},upload:async()=>{uploaded=true;},log:()=>{}}));assert.equal(uploaded,false);
});
test('custom hidden API prompt emits no secret and restores terminal mode',async()=>{
  const input=new PassThrough(),output=new PassThrough();let text='';input.isTTY=output.isTTY=true;input.setRawMode=value=>{input.isRaw=value;};output.on('data',b=>{text+=b;});
  const entered=hiddenKey(input,output,{label:'Alchemy app API key (hidden): ',maxLength:128});input.write(key+'\r');assert.equal(await entered,key);assert(!text.includes(key));assert(text.includes('Alchemy'));assert.equal(input.isRaw,false);
});
test('Worker health reveals only configuration mode and invalid secrets stay private',async()=>{
  const worker=createUnifiedWorker({expanded:true});
  const r=await worker.fetch(new Request('https://test/health'),{ALCHEMY_API_KEY:key}),text=await r.text();assert.equal(r.status,200);assert.equal(JSON.parse(text).rpc_configuration,'alchemy_account_plus_publicnode');assert(!text.includes(key));
  const broken='do not log this secret value';const error=await worker.fetch(new Request('https://test/health'),{ALCHEMY_API_KEY:broken});assert.equal(error.status,503);assert(!(await error.text()).includes(broken));
});
