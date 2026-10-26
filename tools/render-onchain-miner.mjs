import { mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function onchainDescriptor({id,baseUrl}) {
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)throw new Error('Supply an available positive signed-32-bit candidate ID');
  const url=new URL(baseUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Supply a bare HTTP(S) origin');
  const param=(name,description)=>({name,type:'string',intents:['*'],description});
  const endpoint=(path,intent,description,required,optional)=>({path,external_path:path,method:'GET',intents:[intent],description,params:{query:{required:required.map(x=>param(...x)),optional:optional.map(x=>param(...x))}}});
  return {version:'1',kind:'miner',id,slug:'referenceforge-onchain',protocol:'generic',name:'ReferenceForge Onchain',base_url:url.origin,auth:{type:'none'},description:'Two-operator verification of Base and Base Sepolia transactions and exact block-pinned metrics. No Solana, internal ETH transfers, NFT decoding, trace execution or bridge-settlement verification. Independent RPC agreement is not a cryptographic proof. Unknown, pending and unavailable are explicit.',endpoints:[
    endpoint('/verify-transfer','CRYPTO_TRANSFER_VERIFY','Verify top-level native value or ERC-20 Transfer events against optional expectations. Returns exact raw amounts, execution status, L2 confirmations, fees and block evidence. Token event recipients can differ from the transaction recipient. One event must satisfy every expectation.',[['chain','base or base-sepolia; explicitly choose the chain'],['tx_hash','Exact 32-byte transaction hash'],['asset','native or erc20']], [['token','Required contract address for erc20; forbidden for native'],['expected_from','Expected transfer sender address, not necessarily transaction signer for ERC-20'],['expected_to','Expected transfer recipient address'],['expected_amount','Exact uint256 decimal string in wei or token base units; not a formatted token amount'],['min_confirmations','Required L2 block confirmations, 1 to 100000; default 1. This does not establish L1 finality']]),
    endpoint('/onchain-metric','ONCHAIN_METRIC_VERIFY','Verify native_balance, erc20_balance, transaction, gas or logs on Base/Base Sepolia. Balances use EIP-1898 canonical block-hash state reads plus a post-read canonicality check. Transaction metrics use the inclusion block; gas means gas used, not gas price.',[['chain','base or base-sepolia'],['metric','native_balance, erc20_balance, transaction, gas or logs']], [['address','Required wallet for balances'],['token','Required contract for erc20_balance'],['block','Balance scope: safe (default), finalized or exact decimal/hex block number string; latest/pending refused'],['tx_hash','Required only for transaction, gas or logs metrics']])
  ],semantics:{signal_mapping:{label_field:'score_value',reason_field:'summary'},supported_intents:['CRYPTO_TRANSFER_VERIFY','ONCHAIN_METRIC_VERIFY']},errors:{message_path:'error.message',code_path:'error.code'},rate_limit_per_sec:1,cache_ttl_sec:0,circuit_threshold:3,circuit_cooldown_seconds:30};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
  const descriptor=onchainDescriptor({id:Number(args.id),baseUrl:args['base-url']}),text=JSON.stringify(descriptor,null,2)+'\n';
  await mkdir(new URL('../dist/',import.meta.url),{recursive:true});await writeFile(new URL('../dist/onchain-miner.yaml',import.meta.url),text);
  console.log(JSON.stringify({file:'dist/onchain-miner.yaml',sha256:'0x'+createHash('sha256').update(text).digest('hex'),status:'local_candidate_not_hosted_or_registered'}));
}
