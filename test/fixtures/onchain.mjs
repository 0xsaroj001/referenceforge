import { NETWORKS } from '../../src/onchain/input.mjs';
import { TRANSFER_TOPIC } from '../../src/onchain/verify.mjs';

export const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),TOKEN='0x'+'33'.repeat(20),OTHER='0x'+'44'.repeat(20);
export const TX='0x'+'aa'.repeat(32),BLOCK='0x'+'bb'.repeat(32),BAD='0x'+'cc'.repeat(32);
export const NOW=Date.parse('2026-10-25T15:00:00Z');
export const HEX=n=>'0x'+BigInt(n).toString(16);
const topic=a=>'0x'+a.slice(2).padStart(64,'0');
export const event=(from=A,to=B,amount='3000000',index=0,token=TOKEN)=>({address:token,topics:[TRANSFER_TOPIC,topic(from),topic(to)],data:'0x'+BigInt(amount).toString(16).padStart(64,'0'),blockHash:BLOCK,blockNumber:HEX(900),transactionHash:TX,transactionIndex:'0x1',logIndex:HEX(index),removed:false});
export function fixture({chain='base-sepolia',state='mined',logs=[event()],mutate,transport}={}) {
  const calls=[],network=NETWORKS[chain],chainId=network.chainId;
  const transaction={hash:TX,from:A,to:TOKEN,value:HEX('123456789012345678901234567890'),nonce:'0x7',gas:HEX(100000),input:'0x',type:'0x2',chainId:HEX(chainId),blockHash:BLOCK,blockNumber:HEX(900),transactionIndex:'0x1'};
  const receipt={transactionHash:TX,from:A,to:TOKEN,blockHash:BLOCK,blockNumber:HEX(900),transactionIndex:'0x1',status:state==='reverted'?'0x0':'0x1',gasUsed:HEX(21000),effectiveGasPrice:HEX(100),l1Fee:HEX(1000),operatorFeeScalar:'0x0',operatorFeeConstant:'0x0',logs:state==='reverted'?[]:logs};
  if(state==='pending'){transaction.blockHash=null;transaction.blockNumber=null;transaction.transactionIndex=null;}
  const header=(n=900n)=>({number:HEX(n),hash:n===900n?BLOCK:'0x'+n.toString(16).padStart(64,'0'),parentHash:'0x'+'dd'.repeat(32),timestamp:HEX(NOW/1000-10),baseFeePerGas:HEX(20)});
  async function fetchImpl(url,options) {
    const index=url===network.providers[0].url?0:1,payload=JSON.parse(options.body);
    calls.push({operator:index,methods:payload.map(x=>x.method),params:payload.map(x=>x.params)});
    const rows=payload.map(({id,method,params})=>{
      let result;
      if(method==='eth_chainId')result=HEX(chainId);
      else if(method==='eth_getTransactionByHash')result=state==='unknown'?null:transaction;
      else if(method==='eth_getTransactionReceipt')result=['unknown','pending'].includes(state)?null:receipt;
      else if(method==='eth_getBlockByNumber'){const n=['safe','finalized'].includes(params[0])?900n:params[0]==='latest'?1000n:BigInt(params[0]);result=header(n);}
      else if(method==='eth_getBalance')result=HEX('900719925474099312345');
      else if(method==='eth_getCode')result='0x6001600055';
      else if(method==='eth_call')result='0x'+((1n<<200n)+123n).toString(16).padStart(64,'0');
      else throw new Error('Unexpected method in read-only fixture');
      result=structuredClone(result);
      if(mutate)result=mutate({method,result,index,params,calls,transaction,receipt,header});
      return {jsonrpc:'2.0',id,result};
    });
    if(transport)return transport({index,rows,options,calls});
    return new Response(JSON.stringify(rows));
  }
  return {fetchImpl,calls,transaction,receipt,header,network};
}
