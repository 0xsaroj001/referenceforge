// Original public-safe synthetic demonstration. No protected gold or source capture.
import {WALLET_INTENT,WALLET_NETWORKS} from '../../tools/lib/wallet-proof.mjs';
export function walletProofFixture(){
  const stamp='2026-11-03T16:00:00.000Z',hash='0x'+'12'.repeat(32),account='0x'+'ab'.repeat(20);
  const header={hash,number:'0x64',timestamp:'0x'+(Date.parse(stamp)/1000-10).toString(16)};
  const input={chain:'base',address:account},query={method:'eth_getBalance',params:[account,{blockHash:hash,requireCanonical:true}]};
  const fixture={synthetic:true,checked_at:stamp,input,
    contract:{status:200,body:{intent_id:WALLET_INTENT,class:'deterministic',request:{schema_version:1,params:[{name:'address',type:'string',required:true},{name:'chain',type:'string',required:true},{name:'token',type:'string'}]},response:{format_version:1,fields:[{name:'address',type:'string'},{name:'chain',type:'string'},{name:'balance',type:'number',unit:'whole token units',range:[0,1e15],scored:true,decimals:6},{name:'token_symbol',type:'string'},{name:'as_of',type:'string'}]}}},
    provider:{status:200,body:{provider_status:'ok',intent:WALLET_INTENT,...input,balance:0.125,token_symbol:'ETH',as_of:stamp,request_schema_version:5,response_format_version:5,
      evidence:{network:'base',chain_id:'8453',address:account,token:null,token_decimals:'18',unit:'ETH',verified_answer:true,observed_at:stamp,value_raw:'125000000000000000',block:{hash,number:'100',timestamp:String(Date.parse(stamp)/1000-10)}}}},
    references:WALLET_NETWORKS.base.sources.map(source=>({source,chain_id:'0x2105',block:structuredClone(header),head:structuredClone(header),canonical_after:structuredClone(header),query:structuredClone(query),balance_wei:'0x'+125000000000000000n.toString(16),completed_at:stamp})),
    refusals:['unsupported_chain','malformed_address','unsupported_token'].map(name=>({name,status:422,body:{error:{code:'SYNTHETIC_REFUSAL'}}}))};
  fixture.provider.raw_body=JSON.stringify(fixture.provider.body);return fixture;
}
