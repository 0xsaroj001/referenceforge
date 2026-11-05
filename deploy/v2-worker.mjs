import {createUnifiedWorker} from './unified-worker.mjs';
import {createUnifiedHandler,unifiedHealth} from '../src/unified.mjs';
import {createV2Handler,V2_INTENTS,V2_PATHS} from '../src/v2.mjs';
import {createMiner} from '../src/miner.mjs';
import {createSources} from '../src/upstream.mjs';
import {createWeather} from '../src/weather.mjs';
import {createOnchainMiner} from '../src/onchain/verify.mjs';
import {networksForEnv} from '../src/onchain/input.mjs';

const extraAssets=new Set(['/referenceforge-v2.yaml','/v2-contract-manifest.json','/referenceforge-places-v2.yaml','/v2-places-contract-manifest.json']);
export function createV2Worker({servicesFactory,maxConcurrent=8,locationResolver,onDiagnostic=detail=>console.log(JSON.stringify({service:'ReferenceForge',event:'v2_request',...detail}))}={}){
  const numericCache=new Map(),weatherCache=new Map(); // Resolved bounded entries only.
  const inner=createUnifiedWorker({maxConcurrent,handlerFactory:env=>{
    const services=servicesFactory?servicesFactory(env):{
      numeric:createMiner({sources:createSources({cache:numericCache,cacheApi:globalThis.caches?.default})}),
      weatherMiner:createWeather({cache:weatherCache,cacheApi:globalThis.caches?.default}),
      onchain:createOnchainMiner({networks:networksForEnv(env),onRpcError:detail=>console.warn(JSON.stringify({service:'ReferenceForge',event:'rpc_failure',...detail}))})
    };
    const legacy=createUnifiedHandler({...services,expanded:true,weather:true});
    const v2=createV2Handler({...services,locationResolver,onDiagnostic});
    return async request=>{
      const path=new URL(request.url).pathname;
      if(path==='/health'&&request.method==='GET')return Response.json({
        ...unifiedHealth(true,true),version:locationResolver?'0.7.0':'0.6.0',supported_intents:[...V2_INTENTS],
        legacy_capability_families:unifiedHealth(true,true).supported_intents,
        endpoints:[...V2_PATHS,...unifiedHealth(true,true).endpoints],
        registry_status_checked_by_health:false,
        registration_lookup_url:'https://devnode.telegraphprotocol.com/miner-dispatcher/miners/address/0xfec66e0f5c64296ff190edced88c781eeedfd9d3/yamls',
        ...(locationResolver?{weather_location_inputs:'Coordinates or exact 2026 Census place name plus state; internal reference point, no street or fuzzy geocoding.'}:{}),
        scope:'V2 subset: annual unemployment, mined Base transaction lookup, native ETH wallet balance, US NWS observations and 1..48 hour forecasts. Legacy routes retained. Consult the registry/node for admission and scoring state.'
      },{headers:{'cache-control':'no-store'}});
      return path.startsWith('/v2/')?v2(request):legacy(request);
    };
  }});
  return {async fetch(request,env={}){
    const path=new URL(request.url).pathname;
    if(!extraAssets.has(path))return inner.fetch(request,env);
    if(!['GET','HEAD'].includes(request.method))return Response.json({error:{code:'METHOD_NOT_ALLOWED'}},{status:405,headers:{allow:'GET, HEAD'}});
    if(!env.ASSETS)return Response.json({error:{code:'ASSETS_NOT_CONFIGURED'}},{status:503});
    const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
    headers.set('cache-control','no-store');headers.set('x-content-type-options','nosniff');
    if(path.endsWith('.yaml'))headers.set('content-type','application/yaml; charset=utf-8');
    return new Response(response.body,{status:response.status,headers});
  }};
}
export default createV2Worker();
