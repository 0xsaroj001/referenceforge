// Owner-run deployment + one reviewed routing repair. Never accept keys as args.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JsonRpcProvider} from 'ethers';
import {CONFIG} from './expand-miner.mjs';
import {repairStatus} from './repair-routing-miner.mjs';
export function finalizationSteps(args){
 if(args.length>1||args.length===1&&!['--check','--interactive','--status'].includes(args[0]))throw new Error('Use --check, --interactive or --status. Never pass a key.');
 const mode=args[0]??'--check';
 return mode==='--status'?[['tools/repair-routing-miner.mjs','--status']]:mode==='--interactive'?[['tools/repair-routing-miner.mjs','--preflight'],['tools/release-quality.mjs','--deploy'],['tools/repair-routing-miner.mjs','--interactive']]:[['tools/release-quality.mjs','--check'],['tools/repair-routing-miner.mjs',mode]];
}
export function executeFinalizationSteps(args,run){for(const step of finalizationSteps(args)){const r=run(step);if(r.error)throw r.error;if(r.status!==0)return r.status??1;}return 0;}
async function main(){
 const args=process.argv.slice(2),mode=args[0]??'--check';finalizationSteps(args);
 if(mode==='--interactive'&&(!process.stdin.isTTY||!process.stdout.isTTY))throw new Error('Run this command in your own terminal for hidden key entry.');
 const root=resolve(import.meta.dirname,'..');process.chdir(root);
 const code=executeFinalizationSteps(args,step=>spawnSync(process.execPath,step,{cwd:root,stdio:'inherit'}));if(code!==0){process.exitCode=code;return;}
 if(mode!=='--interactive')return;
 const p=new JsonRpcProvider(CONFIG.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});try{
  for(let attempt=0;attempt<4;attempt++){const s=await repairStatus(p);if(!s.record){console.log('Repair cancelled before a transaction. Runtime upload may already be complete.');return;}
   if(s.nodeActive&&s.catalogueComplete){console.log('Verified: corrected registration is active on-chain, indexed active, and its catalogue exposes every ten-intent endpoint.');return;}
   if(s.record.state!=='confirmed'){console.log('Transaction status is uncertain or pending. Use node tools/finalize-referenceforge.mjs --status; no automatic resend.');process.exitCode=2;return;}
   if(attempt<3){console.log('Chain confirmed; waiting for node/catalogue indexing. No further transaction.');await new Promise(r=>setTimeout(r,10000));}
  }
  console.log('Indexing is not yet fully verified. Use node tools/finalize-referenceforge.mjs --status. Do not repeat a transaction.');process.exitCode=2;
 }finally{p.destroy();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(e){console.error(e.message);process.exitCode=1;}}
