import module from './comparator-v2-public/referenceforge-comparator-v2.wasm';
import identity from './comparator-v2-public/identity.json';
import {createComparatorExecutor} from '../src/comparator-runnable.mjs';
const executor=createComparatorExecutor(module,identity);
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  let response;
  if(path==='/referenceforge-comparator-v2.wasm'&&['GET','HEAD'].includes(request.method))response=await env.ASSETS.fetch(request);
  else response=await executor.fetch(request);
  console.log(JSON.stringify({service:'ReferenceForge comparator v2',path,status:response.status}));
  return response;
}};
