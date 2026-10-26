import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnits } from 'ethers';
import { createUnifiedHandler, EXPANDED_INTENTS } from '../src/unified.mjs';
import { createOnchainMiner } from '../src/onchain/verify.mjs';
import { createMiner } from '../src/miner.mjs';
import { createSources } from '../src/upstream.mjs';
import { expandedDescriptor } from '../tools/render-expanded-miner.mjs';
import { fixture, NOW, A, TOKEN, TX, BAD } from './fixtures/onchain.mjs';
import { cases } from './fixtures/onchain-cases.mjs';
const word = n => '0x' + BigInt(n).toString(16).padStart(64,'0');
function setup({decimals=6, balance=(1n<<200n)+123n, mutate, ...rest}={}) {
  const f=fixture({...rest,mutate:x=>{
    let result=x.result;
    if(x.method==='eth_call'&&x.params[0].data==='0x313ce567')result=word(decimals);
    if(x.method==='eth_call'&&x.params[0].data.startsWith('0x70a08231'))result=word(balance);
    if(x.method==='eth_getBalance')result='0x'+BigInt(balance).toString(16);
    return mutate?mutate({...x,result}):result;
  }});
  return {...f,miner:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW,rpcTimeoutMs:1000})};
}
const wallet={chain:'base-sepolia',address:A};
const tokenWallet={...wallet,asset:'erc20',token:TOKEN};
test('expansion keeps all four existing intents by default; omission of FX_NOW is explicit only',()=>{
  const d=expandedDescriptor();assert.deepEqual(d.semantics.supported_intents,[...EXPANDED_INTENTS]);assert.equal(d.endpoints.length,7);
  const six=expandedDescriptor({keepFx:false});assert.equal(six.semantics.supported_intents.length,6);assert(!six.endpoints.some(x=>x.path==='/fx'));
  assert.match(d.description,/institutional.*not implemented/);
});
for(const [asset,decimals,balance] of [['native',18,900719925474099312345n],['erc20',6,(1n<<200n)+123n],['erc20',0,123n],['erc20',255,1n],['native',18,0n],['erc20',6,0n]])
test(`wallet exact scaling ${asset}/${decimals}/${balance}`,async()=>{
  const f=setup({decimals,balance}),answer=await f.miner.wallet(asset==='native'?wallet:tokenWallet);
  const expected=decimals===255?'0.'+'0'.repeat(254)+'1':formatUnits(balance,decimals).replace(/\.0$/,'');
  assert.equal(answer.intent,'WALLET_BALANCE_CHECK');assert.equal(answer.score_value,expected);assert.equal(answer.balance,expected);
  assert.equal(answer.value_raw,balance.toString());assert.equal(answer.block.number,'998');assert.equal(answer.requested_block,'current');assert.equal(answer.tag_resolution.confirmation_buffer_blocks,'2');
  assert.equal(answer.verification.sources.length,2);assert.equal(answer.token_decimals,String(decimals));assert.equal(answer.verified_answer,true);
  for(const call of f.calls.flatMap(c=>c.params).filter(p=>typeof p.at(-1)==='object'&&p.at(-1)?.blockHash))assert.equal(call.at(-1).requireCanonical,true);
});
test('wallet rejects unsupported scopes before any RPC call',async()=>{
  for(const p of [{...wallet,chain:'ethereum'},{...wallet,address:'vitalik.eth'},{...wallet,asset:'nft'},{...tokenWallet,asset:'native'}, {...wallet,block:'latest'}, {...wallet,rpc_url:'http://localhost'}, {...wallet,asset:'erc20'}]){
    const f=setup();await assert.rejects(f.miner.wallet(p));assert.equal(f.calls.length,0);
  }
});
for(const [name,mutate,code] of [
  ['balance disagreement',x=>x.index===1&&x.method==='eth_call'&&x.params[0].data.startsWith('0x70a08231')?word(99):x.result,'RPC_DISAGREEMENT'],
  ['decimals disagreement',x=>x.index===1&&x.method==='eth_call'&&x.params[0].data==='0x313ce567'?word(18):x.result,'RPC_DISAGREEMENT'],
  ['missing decimals',x=>x.method==='eth_call'&&x.params[0].data==='0x313ce567'?'0x':x.result,'INVALID_RPC_DATA'],
  ['invalid decimals',x=>x.method==='eth_call'&&x.params[0].data==='0x313ce567'?word(256):x.result,'INVALID_TOKEN_DECIMALS'],
  ['not a token contract',x=>x.method==='eth_getCode'?'0x':x.result,'NOT_A_CONTRACT'],
  ['reorg after state reads',x=>x.method==='eth_getBlockByNumber'&&x.params[0]!=='latest'&&x.calls.length>=7?{...x.result,hash:BAD}:x.result,'REORG_DETECTED'],
  ['stale head',x=>x.method==='eth_getBlockByNumber'?{...x.result,timestamp:'0x'+BigInt(NOW/1000-121).toString(16)}:x.result,'STALE_RPC_HEAD'],
  ['wrong chain',x=>x.index===1&&x.method==='eth_chainId'?'0x1':x.result,'WRONG_RPC_CHAIN']
])test('wallet refuses '+name,async()=>{
  const f=setup({mutate});await assert.rejects(f.miner.wallet(tokenWallet),{code});
});
test('lookup distinguishes zero/reverted from pending and unknown without fabricating a result',async()=>{
  for(const state of ['mined','reverted','pending','unknown']){
    const f=setup({state}),a=await f.miner.lookup({chain:'base-sepolia',tx_hash:TX});
    assert.equal(a.intent,'ONCHAIN_TX_LOOKUP');assert.equal(a.score_value,state==='mined'?'1':state==='reverted'?'0':null);
    assert.equal(a.verified_answer,['mined','reverted'].includes(state));
  }
});
for(const field of ['status','gas_used','value_wei','from','to','block_number'])test('lookup selects '+field,async()=>{
  const f=setup(),a=await f.miner.lookup({chain:'base-sepolia',tx_hash:TX,field});
  assert.equal(a.score_value,field==='status'?'1':field==='gas_used'?'21000':a.transaction[field]);
  assert(a.receipt&&a.transaction&&a.fees);assert.equal(a.receipt.status,'1');
});
test('lookup absent recipient for contract creation is inconclusive',async()=>{
  const f=setup({mutate:x=>['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(x.method)?{...x.result,to:null}:x.result});
  const a=await f.miner.lookup({chain:'base-sepolia',tx_hash:TX,field:'to'});assert.equal(a.score_value,null);assert.equal(a.fulfillment,'inconclusive');
});
test('lookup validates hash, field and parameters before I/O',async()=>{
  for(const params of [{chain:'base-sepolia',tx_hash:'bad'},{chain:'base-sepolia',tx_hash:TX,field:'trace'},{chain:'base-sepolia',tx_hash:TX,rpc_url:'http://localhost'}]){
    const f=setup();await assert.rejects(f.miner.lookup(params));assert.equal(f.calls.length,0);
  }
});
for(const c of cases.filter(c=>c.method==='transfer'&&c.error&&['provider_disagreement','identity','reorg','freshness','transport','fee_scope'].includes(c.family)))test('lookup fault requirement '+c.id,async()=>{
  const f=fixture(c.options),miner=createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW,rpcTimeoutMs:c.rpcTimeoutMs??1000});
  await assert.rejects(miner.lookup({chain:'base-sepolia',tx_hash:TX}),{code:c.error});
});
test('wallet current-head divergence is refused instead of selecting stale state',async()=>{
  const f=setup({mutate:x=>x.index===1&&x.method==='eth_getBlockByNumber'&&x.params[0]==='latest'?x.header(1005n):x.result});
  await assert.rejects(f.miner.wallet(wallet),{code:'RPC_HEAD_DIVERGENCE'});
});
test('wallet adjacent fresh heads resolve to the same lower canonical height',async()=>{
  const f=setup({mutate:x=>x.index===1&&x.method==='eth_getBlockByNumber'&&x.params[0]==='latest'?x.header(1002n):x.result});
  const a=await f.miner.wallet(wallet);assert.equal(a.block.number,'998');assert.equal(a.tag_resolution.height_difference,'2');assert.equal(a.tag_resolution.confirmation_buffer_blocks,'2');
});
test('current wallet observes one head per operator rather than racing repeated latest reads',async()=>{
  const counts=[0,0];
  const f=setup({mutate:x=>x.method==='eth_getBlockByNumber'&&x.params[0]==='latest'?x.header(++counts[x.index]===1?1002n:1000n):x.result});
  const a=await f.miner.wallet(wallet);assert.equal(a.block.number,'1000');assert.deepEqual(counts,[1,1]);
  for(const call of f.calls.filter(x=>x.methods.includes('eth_chainId')))assert.equal(call.methods.filter(x=>x==='eth_getBlockByNumber').length,1);
});
test('currency conversion maps the converted amount, including zero and exact fractions',async()=>{
  const now=()=>new Date(NOW),numeric=createMiner({now,sources:createSources({now,fetchImpl:async()=>new Response("<Envelope><Cube time='2026-10-23'><Cube currency='USD' rate='2'/><Cube currency='INR' rate='100'/></Cube></Envelope>")})});
  const handler=createUnifiedHandler({numeric,expanded:true});
  for(const [amount,expected] of [['100','5000.000000000000'],['0','0.000000000000'],['0.000000000001','0.000000000050']]){
    const r=await handler(new Request('https://test/convert?base=USD&quote=INR&amount='+amount));const a=await r.json();
    assert.equal(r.status,200);assert.equal(a.intent,'CURRENCY_EXCHANGE');assert.equal(a.score_value,expected);assert.equal(a.numeric_value,expected);assert.equal(a.rate,'50.000000000000');
    assert.equal(a.unit,'INR');assert.equal(a.observation_date,'2026-10-23');
  }
  const refused=await handler(new Request('https://test/convert?question=intraday+USD+to+INR'));assert.equal(refused.status,422);assert(!Object.hasOwn(await refused.json(),'score_value'));
});
test('expanded HTTP routes native wallet and transaction requests and rejects duplicate inputs',async()=>{
  const f=setup(),handler=createUnifiedHandler({onchain:f.miner,expanded:true});
  for(const [path,params,intent] of [['/tx',{chain:'base-sepolia',tx_hash:TX},'ONCHAIN_TX_LOOKUP'],['/wallet-balance',wallet,'WALLET_BALANCE_CHECK']]){
    const r=await handler(new Request('https://test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params)}));assert.equal(r.status,200);assert.equal((await r.json()).intent,intent);
    assert.equal((await handler(new Request('https://test'+path+'?chain=base&chain=base-sepolia'))).status,400);
  }
});
