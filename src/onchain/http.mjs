import { ServiceError } from '../errors.mjs';
import { failureResponse } from '../responses.mjs';
import { NETWORKS, fail } from './input.mjs';
import { boundedText } from './rpc.mjs';
import { createOnchainMiner } from './verify.mjs';

export function onchainHealth() {
  return {status:'ok',service:'ReferenceForge Onchain',version:'0.1.0',supported_intents:['CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY'],endpoints:['/verify-transfer','/onchain-metric'],supported_networks:Object.keys(NETWORKS),network_admission:'unverified',payment_flow_verified:false};
}
export function createOnchainHandler({miner=createOnchainMiner(),maxConcurrent=8}={}) {
  let active=0;
  return async function handle(request) {
    const started=performance.now();
    const send=(status,body)=>new Response(JSON.stringify(body)+'\n',{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
    let admitted=false;
    try {
      const url=new URL(request.url);
      if(url.pathname==='/health'&&request.method==='GET')return send(200,onchainHealth());
      if(!['/verify-transfer','/onchain-metric'].includes(url.pathname))fail('NOT_FOUND','Unknown endpoint',404);
      if(!['GET','POST'].includes(request.method))fail('METHOD_NOT_ALLOWED','Use GET query parameters or POST JSON',405);
      if(active>=maxConcurrent)fail('CAPACITY_LIMIT','Local service concurrency limit reached; retry later',503);
      active++;admitted=true;
      const params=Object.create(null);
      for(const [key,value] of url.searchParams){if(Object.hasOwn(params,key))fail('DUPLICATE_PARAMETER','Duplicate query parameter',400);params[key]=value;}
      if(request.method==='POST') {
        if(!(request.headers.get('content-type')??'').startsWith('application/json'))fail('UNSUPPORTED_MEDIA_TYPE','POST requires application/json',415);
        let body;
        try {const text=await boundedText(request,16384,request.signal);body=JSON.parse(text);}
        catch {fail('INVALID_BODY','Expected a JSON object no larger than 16 KiB',400);}
        if(!body||Array.isArray(body)||typeof body!=='object')fail('INVALID_BODY','Expected one JSON object',400);
        for(const [key,value] of Object.entries(body)) {
          if(Object.hasOwn(params,key)&&params[key]!==value)fail('CONFLICTING_PARAMETER','Body and query parameters disagree',400);
          params[key]=value;
        }
      }
      if(Object.values(params).some(v=>!['string','number'].includes(typeof v)))fail('INVALID_PARAMETER','Parameters must be scalar strings; chain ID and confirmation count may also be numbers',400);
      if(Object.keys(params).length>12||Object.values(params).some(v=>String(v).length>256))fail('INVALID_PARAMETER','Parameter size exceeds the supported bound',400);
      const result=await miner[url.pathname==='/verify-transfer'?'transfer':'metric'](params,{signal:request.signal});
      return send(200,{...result,duration_ms:Math.round((performance.now()-started)*1000)/1000});
    } catch(error) {
      const failure=failureResponse(error instanceof ServiceError?error:new ServiceError('INTERNAL_ERROR','Unexpected service error',500));
      return send(failure.status,failure.body);
    } finally {if(admitted)active--;}
  };
}
