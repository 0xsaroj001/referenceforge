// Direct Provider/reference checks and public discovery snapshots.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {boundedText} from '../src/onchain/rpc.mjs';
import {assessTxPair} from './lib/provider-tx-acceptance.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
const digest=text=>createHash('sha256').update(text).digest('hex');
const reportDir=resolve(root,'reports/provider-acceptance',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));
let report;
if(args[0]==='--replay'){
  assert.equal(args.length,2,'Use --replay <private capture.json>');
  const capture=JSON.parse(await readFile(resolve(args[1]),'utf8'));report=assessTxPair(capture);
}else{
  assert(args.length===4&&args[0]==='--chain'&&args[2]==='--tx','Use --chain base|base-sepolia --tx <transaction hash>, or --replay <capture.json>');
  const chain=args[1],txHash=args[3];assert(['base','base-sepolia'].includes(chain)&&/^0x[0-9a-f]{64}$/i.test(txHash),'Invalid supported chain/hash');
  const providers=chain==='base'?[['Base','https://mainnet.base.org'],['PublicNode','https://base-rpc.publicnode.com']]:[['Base','https://sepolia.base.org'],['PublicNode','https://base-sepolia-rpc.publicnode.com']];
  const checked_at=new Date().toISOString(),transport=[];
  await mkdir(reportDir,{recursive:true});
  async function read(url,init={}){
    const start=performance.now(),signal=AbortSignal.timeout(15000);
    const record={url,method:init.method??'GET'};transport.push(record);
    try{
      const response=await fetch(url,{...init,redirect:'error',signal});record.status=response.status;
      const text=await boundedText(response,2097152,signal);record.sha256=digest(text);record.response_text=text;
      return {status:response.status,body:JSON.parse(text),request_id:response.headers.get('x-referenceforge-request-id')};
    }catch(error){record.failure=error.message;throw error;}
    finally{record.elapsed_ms=Math.round(performance.now()-start);}
  }
  async function reference([operator,url]){
    const capture={};
    try{
      async function rpc(method,params){
        const {status,body}=await read(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
        assert(status===200&&body.jsonrpc==='2.0'&&body.id===1&&!body.error&&Object.hasOwn(body,'result'),'Reference RPC refusal: '+method);return body.result;
      }
      capture.chainId=await rpc('eth_chainId',[]);
      capture.transaction=await rpc('eth_getTransactionByHash',[txHash]);
      capture.receipt=await rpc('eth_getTransactionReceipt',[txHash]);
      if(capture.transaction?.blockNumber)capture.block=await rpc('eth_getBlockByNumber',[capture.transaction.blockNumber,false]);
      return {operator,capture};
    }catch(error){return {operator,capture,error:error.message};}
  }
  const path=new URL('/v2/tx','https://referenceforge.0xsaroj001.workers.dev');path.search=new URLSearchParams({chain,tx_hash:txHash});
  const requests=[path.toString(),path.toString().replace('chain='+chain,'chain=ethereum'),new URL('/v2/tx?chain='+chain+'&tx_hash=invalid',path.origin).toString()];
  const [references,responses]=await Promise.all([Promise.all(providers.map(reference)),Promise.all(requests.map(async url=>{try{return await read(url);}catch(error){return {status:'transport_failure',body:{error:{code:error.name}},failure:error.message};}}))]);
  let binding;
  try {
    const [registration,discovery,contract]=await Promise.all([
      read('https://devnode.telegraphprotocol.com/api/miners/4889'),
      read('https://devnode.telegraphprotocol.com/api/miners?intent=ONCHAIN_TX_LOOKUP_GENERAL&status=active&limit=100'),
      read('https://devnode.telegraphprotocol.com/engine/v1/intents/ONCHAIN_TX_LOOKUP_GENERAL')
    ]);
    assert([registration,discovery,contract].every(r=>r.status===200),'Public binding read failed');
    const matches=discovery.body.filter(m=>m.slug==='referenceforge-numeric');
    assert.equal(matches.length,1,'Ambiguous Provider discovery');
    binding={registration:registration.body.miner,discovery:matches[0],contract:{intent_id:contract.body.intent_id,request:contract.body.request,response:contract.body.response}};
  } catch(error) { binding={error:error.message}; }
  const capture={checked_at,input:{chain,txHash},references,provider:responses[0],refusals:[{name:'unsupported_chain',...responses[1]},{name:'malformed_hash',...responses[2]}],binding,transport};
  await writeFile(resolve(reportDir,'capture.json'),JSON.stringify(capture,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(reportDir,'capture.json.sha256'),digest(await readFile(resolve(reportDir,'capture.json')))+'\n',{flag:'wx'});
  report=assessTxPair(capture);report.capture_sha256=digest(await readFile(resolve(reportDir,'capture.json')));
  report.http_calls=transport.length;report.input=capture.input;
}
await mkdir(reportDir,{recursive:true});await writeFile(resolve(reportDir,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,private_report_directory:reportDir},null,2));
if(!report.pass)process.exitCode=1;
