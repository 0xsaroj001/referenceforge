// User-run API credential entry. No wallet key, transaction or paid-plan change.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { hiddenKey, RegistrationError } from './register-miner.mjs';
export function validateAlchemyKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key) || /^(0x)?[0-9a-fA-F]{64}$/.test(key)) throw new RegistrationError('Enter the Alchemy APP API key, not a wallet key, seed phrase or full URL. Nothing uploaded.');
  return key;
}
export async function checkKey(key,{fetchImpl=fetch}={}) {
  validateAlchemyKey(key);
  for(const [host,id] of [['base-mainnet',8453],['base-sepolia',84532]]) {
    const url=`https://${host}.g.alchemy.com/v2`;
    async function call(method,params){
      const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(10000),body:JSON.stringify([{jsonrpc:'2.0',id:1,method,params}])});
      if(!r.ok||!r.body)throw new RegistrationError('Alchemy app could not read both Base networks. Enable Base Mainnet and Base Sepolia with Node RPC. Nothing uploaded.');
      const reader=r.body.getReader(),parts=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new RegistrationError('Unexpected RPC response size. Nothing uploaded.');parts.push(Buffer.from(value));}}
      finally{await reader.cancel();}
      const rows=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(!Array.isArray(rows)||rows.length!==1||rows[0].id!==1||rows[0].error||!Object.hasOwn(rows[0],'result'))throw new RegistrationError('Alchemy could not perform a required read. Nothing uploaded.');return rows[0].result;
    }
    if(BigInt(await call('eth_chainId',[]))!==BigInt(id))throw new RegistrationError('Alchemy endpoint returned the wrong network. Nothing uploaded.');
    const h=await call('eth_getBlockByNumber',['safe',false]);
    if(!h||!/^0x[0-9a-fA-F]{64}$/.test(h.hash))throw new RegistrationError('Alchemy did not return a valid block. Nothing uploaded.');
    const balance=await call('eth_getBalance',['0x0000000000000000000000000000000000000000',{blockHash:h.hash,requireCanonical:true}]);
    if(typeof balance!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(balance))throw new RegistrationError('Alchemy canonical block-hash balance read failed. Nothing uploaded.');
  }
  return {networks:[8453,84532],canonicalBlockHashRead:true};
}
async function uploadSecret(key){
  const root=resolve(import.meta.dirname,'..'),cli=resolve(root,'node_modules/wrangler/bin/wrangler.js'),config=resolve(root,'deploy/expanded.wrangler.jsonc');
  await new Promise((resolveUpload,rejectUpload)=>{
    const child=spawn(process.execPath,[cli,'secret','put','ALCHEMY_API_KEY','--config',config],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    // Never expose CLI error objects or captured output: they may include account data.
    child.stdout.resume();child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',()=>rejectUpload(new RegistrationError('Could not start the authenticated Cloudflare CLI. Nothing else attempted.')));
    child.on('close',code=>code===0?resolveUpload():rejectUpload(new RegistrationError('Cloudflare secret upload did not confirm success. Inspect your account; no automatic retry.')));
    child.stdin.end(key+'\n');
  });
}
export async function configure(key,{check=checkKey,upload=uploadSecret,log=console.log}={}){
  validateAlchemyKey(key);await check(key);await upload(key);log('Alchemy key stored as Cloudflare secret ALCHEMY_API_KEY on Worker referenceforge. Key not printed or saved locally.');
}
async function main(args){
  if(args.length!==1||args[0]!=='--interactive'){console.log('Run: node tools/configure-alchemy.mjs --interactive\nUse an Alchemy FREE app with Node RPC enabled for Base Mainnet and Base Sepolia. This is not a wallet-key prompt.');return;}
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new RegistrationError('Use your normal local terminal. No key read.');
  console.log('Target: Cloudflare account 35b26bd77aa13f5f1c008027783d71ca, Worker referenceforge.\nThis verifies bounded RPC reads on BOTH networks, then uploads one API key as a Worker secret. It deploys a new Worker version with the same code.\nNo wallet transaction, plan purchase, spending upgrade or intent registration. Confirm your Alchemy app is on the FREE plan.');
  const prompt=createInterface({input:process.stdin,output:process.stdout});let approved;
  try{approved=await prompt.question('Type CONFIGURE_ALCHEMY_FREE to approve; anything else cancels: ')==='CONFIGURE_ALCHEMY_FREE';}finally{prompt.close();}
  if(!approved)return;
  let key=await hiddenKey(process.stdin,process.stdout,{label:'Alchemy APP API key (hidden; NOT your wallet key): ',maxLength:128});
  try{key=key.trim();await configure(key);}finally{key='';}
  console.log('Next: node tools/smoke-expanded.mjs https://referenceforge.0xsaroj001.workers.dev\nThen re-check the intent update: node tools/expand-miner.mjs --check');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main(process.argv.slice(2));}catch(error){console.error(error instanceof RegistrationError?error.message:'RPC or local setup error. No automatic retry. The key was not printed.');process.exitCode=1;}}
