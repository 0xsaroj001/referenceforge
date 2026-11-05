const hash='0x'+'ab'.repeat(32),blockHash='0x'+'bc'.repeat(32);
const from='0x'+'11'.repeat(20),to='0x'+'22'.repeat(20);

export function txReceiptFixture(){
  const reference={chainId:'0x2105',
    transaction:{hash,from,to,blockHash,blockNumber:'0x64',value:'0x16345785d8a0000'},
    receipt:{transactionHash:hash,from,to,blockHash,blockNumber:'0x64',status:'0x1'},
    block:{hash:blockHash,number:'0x64',transactions:[hash]}
  };
  const answer={provider_status:'ok',intent:'ONCHAIN_TX_LOOKUP_GENERAL',
    request_schema_version:1,response_format_version:1,
    tx_hash:hash,status:'confirmed',from,to,block_number:100,value_eth:0.1
  };
  const names=['tx_hash','status','from','to','block_number','value_eth'];
  const owner='0xfec66e0f5c64296ff190edced88c781eeedfd9d3';
  const source={checked_at:'2026-11-05T00:00:00Z',input:{chain:'base',txHash:hash},
    references:['A','B'].map(operator=>({operator,capture:structuredClone(reference)})),
    provider:{status:200,body:answer,request_id:'synthetic-request'},
    binding:{
      registration:{registration_id:4889,slug:'referenceforge-numeric',miner_address:owner,activation_status:'active'},
      discovery:{id:'1900999000',slug:'referenceforge-numeric',wallet_address:owner,activation_status:'active'},
      contract:{intent_id:answer.intent,request:{schema_version:1},response:{format_version:1,fields:names.map(name=>({name}))}}
    }
  };
  const receipt={miner_id:'1900999000',intent:answer.intent,endpoint:'/v2/tx',
    input:{chain:'base',tx_hash:hash},input_schema_version:1,format_version:1,result_shape:'intent',
    result:Object.fromEntries(names.map(name=>[name,answer[name]])),
    field_status:Object.fromEntries(names.map(name=>[name,'ok'])),signal_hash:'0x'+'34'.repeat(32)
  };
  return {source,receipt};
}
