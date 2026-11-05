// Loopback-only owner utility: serves a keyless wallet UI and read-only plans.
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';
import {JsonRpcProvider} from 'ethers';import {SWAP_CONFIG,inspectTestMachinaSwap} from './lib/test-machina-swap.mjs';
const origin='http://127.0.0.1:8796',html=await readFile(new URL('./test-funding-page.html',import.meta.url)),js=await readFile(new URL('./test-funding-client.mjs',import.meta.url));
const provider=new JsonRpcProvider(SWAP_CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});let planning=false;
const server=createServer(async(req,res)=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
  const reply=(status,type,body)=>{res.writeHead(status,{...headers,'content-type':type});res.end(body);};
  if(req.headers.host!=='127.0.0.1:8796')return reply(403,'text/plain','Unexpected Host');
  if(req.headers.origin&&req.headers.origin!==origin)return reply(403,'text/plain','Unexpected Origin');
  if(req.method!=='GET')return reply(405,'text/plain','Read-only HTTP server');
  if(req.url==='/')return reply(200,'text/html; charset=utf-8',html);
  if(req.url==='/client.js')return reply(200,'application/javascript; charset=utf-8',js);
  if(req.url==='/api/plan'){
    if(planning)return reply(503,'application/json',JSON.stringify({error:'A preflight is already running. Wait briefly and refresh.'}));planning=true;
    try{return reply(200,'application/json',JSON.stringify(await inspectTestMachinaSwap(provider)));}catch(error){return reply(503,'application/json',JSON.stringify({error:error.shortMessage??error.message}));}finally{planning=false;}
  }
  reply(404,'text/plain','Not found');
});
server.listen(8796,'127.0.0.1',()=>console.log('Owner wallet utility ready: '+origin+' . Open it in Optimus Chrome. All HTTP endpoints are read-only; only the browser wallet can sign.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();provider.destroy();});
