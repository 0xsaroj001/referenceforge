import { mkdir,readdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { onchainDescriptor } from './render-onchain-miner.mjs';

export async function prepareOnchainDeployment({id,baseUrl}) {
  const descriptor=onchainDescriptor({id,baseUrl});
  if(!descriptor.base_url.startsWith('https://'))throw new Error('A public deployment requires HTTPS');
  const dir=new URL('../deploy/onchain-public/',import.meta.url);
  await mkdir(dir,{recursive:true});
  const entries=await readdir(dir);if(entries.some(x=>x!=='miner.yaml'))throw new Error('Unexpected file in the explicit onchain upload directory');
  const bytes=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');
  await writeFile(new URL('miner.yaml',dir),bytes);
  const report={prepared_at:new Date().toISOString(),status:'prepared_not_hosted_or_validated',origin:descriptor.base_url,candidate_id:id,identity_reserved:false,yaml_url:descriptor.base_url+'/miner.yaml',yaml_sha256:'0x'+createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,requires_api_key:false,supported_intents:descriptor.semantics.supported_intents,public_assets:['miner.yaml']};
  await mkdir(new URL('../reports/onchain-deployment/',import.meta.url),{recursive:true});
  await writeFile(new URL('../reports/onchain-deployment/prepared-inputs.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
  console.log(JSON.stringify(await prepareOnchainDeployment({id:Number(args.id),baseUrl:args['base-url']}),null,2));
}
