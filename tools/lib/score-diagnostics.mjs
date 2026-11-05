export function classifyScore(s){
  const reason=s.failure_reason??'';
  if(typeof s.score==='number'&&s.score>0)return 'scored_positive';
  if(/build request/s.test(reason)&&/(?:429|RESOURCE_EXHAUSTED)/s.test(reason))return 'platform_request_builder_quota';
  if(/build request/s.test(reason)&&/(?:closed idle connection|http request|timeout|connection refused)/i.test(reason))return 'platform_request_builder_transport';
  for(const [code,label]of [['UNSUPPORTED_CHAIN','unsupported_chain'],['UNSUPPORTED_LOCATION','unsupported_location'],['UNSUPPORTED_FIELD','unsupported_lookup_field'],['INVALID_ADDRESS','missing_or_malformed_address'],['RPC_UNAVAILABLE','rpc_availability'],['SOURCE_UNAVAILABLE','source_availability'],['STALE_SOURCE','stale_source'],['CAPACITY_LIMIT','miner_capacity']])if(reason.includes('['+code+']')||reason.includes(code))return label;
  return reason?'unclassified_failure':'zero_score_without_public_failure';
}
