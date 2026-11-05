import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {txReceiptFixture} from './fixtures/provider-tx.mjs';
import {assessTxNodeReceipt,parseTxCapture} from '../tools/lib/tx-node-receipt.mjs';

test('receipt checks Engine discovery identity and all six fields without claiming execution provenance',()=>{
  const f=txReceiptFixture(),report=assessTxNodeReceipt(JSON.stringify(f.receipt),f.source);
  assert(report.pass);
  assert.equal(report.engine_miner_id,'1900999000');
  assert.equal(report.registration_id,4889);
  assert.equal(report.field_checks.length,6);
  assert.equal(report.node_origin_authenticated,false);
  assert.equal(report.execution_correlation_verified,false);
  assert.equal(report.score_encoding_verified,false);
});

test('a correct block cannot conceal rejected or changed party, amount or state fields',()=>{
  for(const name of ['tx_hash','status','from','to','value_eth']){
    const f=txReceiptFixture();f.receipt.field_status[name]='rejected';f.receipt.result[name]=null;
    const report=assessTxNodeReceipt(JSON.stringify(f.receipt),f.source);
    assert(!report.pass);assert(report.failures.includes('FIELD_NOT_OK:'+name));
    assert.equal(report.field_checks.find(f=>f.field==='block_number').matches_provider,true);
  }
});

test('raw output, stale contract, wrong identity and source conflicts fail',()=>{
  for(const mutate of [
    f=>f.receipt.miner_id='4889',f=>f.receipt.endpoint='/tx',f=>f.receipt.result_shape='raw',
    f=>f.receipt.format_version=4,f=>f.receipt.input.chain='base-sepolia',
    f=>f.receipt.input.extra='ignored',f=>delete f.receipt.signal_hash,
    f=>f.source.binding.discovery.wallet_address='0x'+'99'.repeat(20),
    f=>f.source.binding.registration.activation_status='retired',
    f=>f.source.references[1].capture.transaction.value='0x0',
    f=>f.source.references[1].capture.block.transactions=[],
    f=>f.source.binding.contract.response.fields.pop(),
    f=>delete f.source.binding
  ]){
    const f=txReceiptFixture();mutate(f);
    assert.equal(assessTxNodeReceipt(JSON.stringify(f.receipt),f.source).pass,false);
  }
});

test('duplicate JSON keys and rounded numeric tokens are rejected before comparison',()=>{
  const f=txReceiptFixture(),raw=JSON.stringify(f.receipt);
  assert.throws(()=>parseTxCapture(raw.replace('"value_eth":0.1','"value_eth":0.100000000000000001')),/PRECISION_LOSS/);
  assert.throws(()=>parseTxCapture(raw.replace('"miner_id":','"miner_id":"1900999000","miner_id":')),/DUPLICATE_JSON_KEY/);
  assert.throws(()=>parseTxCapture('{"private-data":no}'),/^AssertionError.*INVALID_JSON/);
});

test('reverted execution keeps attempted amount separate from transferred zero',()=>{
  const f=txReceiptFixture();
  for(const row of f.source.references)row.capture.receipt.status='0x0';
  f.source.provider.body.status=f.receipt.result.status='reverted';
  f.source.provider.body.value_eth=f.receipt.result.value_eth=0;
  assert(assessTxNodeReceipt(JSON.stringify(f.receipt),f.source).pass);
  f.receipt.result.value_eth=0.1;
  assert(!assessTxNodeReceipt(JSON.stringify(f.receipt),f.source).pass);
});

test('offline CLI checks sidecars and produces a consistency report',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'referenceforge-tx-'));
  try{
    const f=txReceiptFixture(),paths=[join(directory,'receipt.json'),join(directory,'source.json')];
    for(const [i,value] of [f.receipt,f.source].entries()){
      const raw=JSON.stringify(value);
      await writeFile(paths[i],raw);
      await writeFile(paths[i]+'.sha256',createHash('sha256').update(raw).digest('hex'));
    }
    const cli=spawnSync(process.execPath,['tools/check-tx-node.mjs',...paths],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    const report=JSON.parse(cli.stdout);
    assert.equal(report.http_calls,0);assert.equal(report.pass,true);
    await writeFile(paths[0],'{}');
    const changed=spawnSync(process.execPath,['tools/check-tx-node.mjs',...paths],{cwd:process.cwd(),encoding:'utf8'});
    assert.notEqual(changed.status,0);
    assert.match(changed.stderr,/INPUT_HASH_CHANGED/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
