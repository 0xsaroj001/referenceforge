// No wallet, signing, broadcast, deployment, Engine ask or paid API is used.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseUniqueJson} from '../evaluator-v2/strict-json.mjs';
import {assessWalletProof,walletInput,WALLET_NETWORKS,WALLET_INTENT,PROVIDER_ORIGIN} from './lib/wallet-proof.mjs';
import {walletProofFixture} from '../test/fixtures/wallet-proof.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  const key=args[i];assert(['--demo','--replay','--chain','--address'].includes(key)&&!Object.hasOwn(options,key),'UNSUPPORTED_OR_DUPLICATE_ARGUMENT');
  options[key]=key==='--demo'?true:args[++i];assert(options[key]!==undefined,'MISSING_ARGUMENT');
}
const demo=!!options['--demo'],replay=options['--replay'];
assert(demo?args.length===1:replay?args.length===2:args.length===4&&options['--chain']&&options['--address'],'Use --demo, --replay <capture.json>, or --chain <base|base-sepolia> --address <0x...>');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory=resolve(root,'reports','wallet-proof',new Date().toISOString().replace(/[:.]/g,'-')+'-'+createHash('sha256').update(String(process.hrtime.bigint())).digest('hex').slice(0,8));
await mkdir(directory,{recursive:true});
const save=(name,value)=>writeFile(resolve(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let capture;
if(demo){capture=walletProofFixture();}
else if(replay){
  const path=resolve(replay),bytes=await readFile(path),expected=(await readFile(path+'.sha256','utf8')).trim();
  assert(/^[0-9a-f]{64}$/.test(expected)&&sha(bytes)===expected,'CAPTURE_HASH_CHANGED');
  capture=parseUniqueJson(bytes.toString('utf8'));
}else{
  const input=walletInput(options['--chain'],options['--address']);
  const started_at=new Date().toISOString(),transport=[];
  const plan={started_at,input,provider_origin:PROVIDER_ORIGIN,sources:WALLET_NETWORKS[input.chain].sources,
    maximum_http_calls:16,maximum_rpc_calls:10,timeout_per_http_ms:15000,maximum_response_bytes:2097152,
    allowed_rpc_methods:['eth_chainId','eth_getBlockByNumber','eth_getBalance'],automatic_retry:false,
    authentication:false,engine_requests:0,payments:0,scope:'Direct author-run integration evidence only'};
  await save('plan.json',plan);
  async function read(url,init={}){
    assert(transport.length<16,'HTTP_BUDGET_EXHAUSTED');
    const record={url,request_method:init.method??'GET',request_body:init.body??null,started_at:new Date().toISOString()};transport.push(record);
    const start=performance.now();
    try{
      const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
      record.status=response.status;record.retry_after=response.headers.get('retry-after');
      const chunks=[];let length=0;const reader=response.body?.getReader();
      if(reader)try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>2097152){await reader.cancel();throw Error('RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}
      record.raw_body=Buffer.concat(chunks).toString('utf8');record.body_sha256=sha(record.raw_body);
      const body=parseUniqueJson(record.raw_body);
      return {status:response.status,body,raw_body:record.raw_body};
    }catch(error){record.error=error.name+': '+error.message;record.cause_code=typeof error.cause?.code==='string'?error.cause.code:null;return {status:record.status??0,error:record.error,cause_code:record.cause_code};}
    finally{record.elapsed_ms=Math.round(performance.now()-start);record.completed_at=new Date().toISOString();}
  }
  const [contract,owner]=await Promise.all([
    read('https://devnode.telegraphprotocol.com/engine/v1/intents/'+WALLET_INTENT),
    read('https://devnode.telegraphprotocol.com/api/miners/4889')]);
  const ownerMatches=owner.body?.miner?.miner_address?.toLowerCase()==='0xfec66e0f5c64296ff190edced88c781eeedfd9d3';
  // An owner mismatch stops service calls; read-only diagnostics are retained.
  if(!ownerMatches){capture={input,contract,owner,checked_at:new Date().toISOString(),provider:{status:0,error:'REFERENCEFORGE_OWNER_UNVERIFIED'},references:[],refusals:[],transport};}
  else{
    const url=new URL('/v2/wallet',PROVIDER_ORIGIN);url.search=new URLSearchParams(input);
    const provider=await read(url.href);
    const negatives=[['unsupported_chain',{...input,chain:'ethereum'}],['malformed_address',{...input,address:'invalid'}],['unsupported_token',{...input,token:'0x'+'11'.repeat(20)}]];
    const refusals=[];
    for(const [name,params]of negatives){const negative=new URL('/v2/wallet',PROVIDER_ORIGIN);negative.search=new URLSearchParams(params);refusals.push({name,...await read(negative.href)});}
    const block=provider.body?.evidence?.block;
    const references=provider.status===200&&/^0x[0-9a-f]{64}$/i.test(block?.hash??'')&&/^(0|[1-9][0-9]{0,12})$/.test(block?.number??'')?
      await Promise.all(WALLET_NETWORKS[input.chain].sources.map(async source=>{
        const row={source};let id=0;
        async function rpc(method,params=[]){
          assert(['eth_chainId','eth_getBlockByNumber','eth_getBalance'].includes(method),'READ_ONLY_METHOD_REQUIRED');
          const body={jsonrpc:'2.0',id:++id,method,params},r=await read(source,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
          assert(r.status===200&&r.body?.jsonrpc==='2.0'&&r.body.id===id&&!r.body.error&&Object.hasOwn(r.body,'result'),'RPC_REFUSAL:'+method);return r.body.result;
        }
        try{
          row.chain_id=await rpc('eth_chainId');
          const height='0x'+BigInt(block.number).toString(16);
          row.block=await rpc('eth_getBlockByNumber',[height,false]);
          row.head=await rpc('eth_getBlockByNumber',['latest',false]);
          row.query={method:'eth_getBalance',params:[input.address,{blockHash:block.hash,requireCanonical:true}]};
          row.balance_wei=await rpc(row.query.method,row.query.params);
          row.canonical_after=await rpc('eth_getBlockByNumber',[height,false]);
        }catch(error){row.error=error.message;}
        row.completed_at=new Date().toISOString();return row;
      })):[];
    capture={started_at,checked_at:new Date().toISOString(),input,contract,owner,provider,references,refusals,transport};
  }
}
const bytes=JSON.stringify(capture,null,2)+'\n';await writeFile(resolve(directory,'capture.json'),bytes,{flag:'wx'});await writeFile(resolve(directory,'capture.json.sha256'),sha(bytes)+'\n',{flag:'wx'});
const report=assessWalletProof(capture);report.capture_sha256=sha(bytes);report.mode=demo?'synthetic_demo':replay?'offline_replay':'live_direct';
report.captured_http_calls=capture.transport?.length??0;
report.http_calls=demo||replay?0:report.captured_http_calls;
if(demo){
  const wrong=structuredClone(capture);wrong.provider.body.address='0x'+'cd'.repeat(20);
  wrong.provider.raw_body=JSON.stringify(wrong.provider.body);
  const result=assessWalletProof(wrong);
  report.deliberate_wrong_address={rejected:!result.pass,reasons:result.failures,numeric_only_baseline_would_miss:true};
  assert(report.pass&&!result.pass,'DEMO_CONTROL_FAILED');
}
await save('result.json',report);
console.log(JSON.stringify({...report,private_report_directory:directory},null,2));
if(!report.pass)process.exitCode=1;
