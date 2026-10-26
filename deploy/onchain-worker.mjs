import { createOnchainHandler } from '../src/onchain/http.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';

const defaultHandlerFactory=()=>createOnchainHandler({miner:createOnchainMiner({onRpcError:detail=>console.warn(JSON.stringify({service:'referenceforge-onchain',event:'rpc_failure',...detail}))})});
export function createOnchainWorker({ handlerFactory=defaultHandlerFactory }={}) {
  return {async fetch(request,env={}) {
    const path=new URL(request.url).pathname;
    if(path==='/miner.yaml') {
      if(!['GET','HEAD'].includes(request.method))return Response.json({status:'error',verified_answer:false,error:{code:'METHOD_NOT_ALLOWED',message:'Use GET or HEAD for the miner descriptor'}},{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}});
      if(!env.ONCHAIN_ASSETS)return Response.json({status:'error',verified_answer:false,error:{code:'ASSETS_NOT_CONFIGURED',message:'Miner descriptor unavailable'}},{status:503});
      const asset=await env.ONCHAIN_ASSETS.fetch(request);
      if(!asset.ok)return asset;
      const headers=new Headers(asset.headers);headers.set('content-type','application/yaml; charset=utf-8');headers.set('cache-control','no-store');headers.set('x-content-type-options','nosniff');
      return new Response(asset.body,{status:asset.status,headers});
    }
    // Request-owned RPC sessions and abort signals never cross Worker requests.
    const response=await handlerFactory()(request);
    console.log(JSON.stringify({service:'referenceforge-onchain',path,status:response.status}));
    return response;
  }};
}
export default createOnchainWorker();
