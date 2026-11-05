import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2Handler} from '../src/v2.mjs';
import {createOnchainMiner} from '../src/onchain/verify.mjs';
import {fixture,TX,NOW} from './fixtures/onchain.mjs';

const request=()=>new Request('https://provider.test/v2/tx?chain=base-sepolia&tx_hash='+TX,{
  headers:{authorization:'Bearer private-token','x-referenceforge-request-id':'untrusted-id'}
});

test('completion diagnostics distinguish verified, pending and absent evidence without retaining inputs',async()=>{
  for(const state of ['mined','reverted','pending','unknown']){
    const f=fixture({state});f.transaction.value='0x16345785d8a0000';
    const events=[],handler=createV2Handler({
      onchain:createOnchainMiner({fetchImpl:f.fetchImpl,now:()=>NOW}),
      onDiagnostic:detail=>events.push(detail)
    });
    const response=await handler(request()),body=await response.json(),event=events[0];
    assert.equal(events.length,1);
    assert.equal(event.request_id,response.headers.get('x-referenceforge-request-id'));
    assert.match(event.request_id,/^[0-9a-f-]{36}$/);
    assert.equal(event.http_status,response.status);
    assert.equal(event.transaction_state,state==='mined'?'mined_success':state);
    assert(Number.isSafeInteger(event.elapsed_ms)&&event.elapsed_ms>=0);
    assert(!JSON.stringify(event).includes(TX));
    assert(!JSON.stringify(event).includes('private-token'));
    assert(!JSON.stringify(event).includes('untrusted-id'));
    if(['pending','unknown'].includes(state)){
      assert.equal(event.stage,'verification');
      assert.equal(event.error_code,'UNSCORED_TRANSACTION_STATE');
      assert.equal(body.block_number,undefined);
    }else{
      assert.equal(event.stage,'response');
      assert.equal(event.error_code,null);
      assert.equal(event.response_format_version,1);
      assert.deepEqual(event.canonical_fields,['tx_hash','status','from','to','block_number','value_eth']);
    }
  }
});

test('source exception and invalid input record different stages with redacted errors',async()=>{
  const events=[],handler=createV2Handler({
    onchain:{lookup:async()=>{throw new Error('secret upstream URL');}},
    onDiagnostic:detail=>events.push(detail)
  });
  assert.equal((await handler(new Request('https://test/v2/tx?chain=base&tx_hash=bad'))).status,422);
  const response=await handler(request());
  assert.equal(response.status,500);
  assert.deepEqual(events.map(e=>e.stage),['validation','source']);
  assert.equal(events[1].error_code,'INTERNAL_ERROR');
  assert(!JSON.stringify(events).includes('secret'));
  assert(!JSON.stringify(await response.json()).includes('secret'));
});

test('diagnostic sink failure cannot leak admission or break simultaneous requests',async()=>{
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const events=[],handler=createV2Handler({maxConcurrent:1,
    onchain:{lookup:async()=>{await blocked;throw new Error('source failure');}},
    onDiagnostic:async detail=>{events.push(detail);throw new Error('logging failure');}
  });
  const first=handler(request());
  const second=await handler(request());
  assert.equal(second.status,503);
  release();assert.equal((await first).status,500);
  assert.equal((await handler(new Request('https://test/v2/tx'))).status,422);
  assert.equal(events.length,3);
  assert.equal(new Set(events.map(e=>e.request_id)).size,3);
  assert.equal(events[0].error_code,'CAPACITY_LIMIT');
});
