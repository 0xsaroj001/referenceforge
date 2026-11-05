import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {walletProofFixture} from './fixtures/wallet-proof.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=args=>spawnSync(process.execPath,['tools/wallet-proof.mjs',...args],{cwd:root,encoding:'utf8',timeout:10000});
test('one-command synthetic demonstration makes no network requests and catches a same-number wrong-wallet answer',()=>{
  const result=run(['--demo']);assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
  assert.equal(report.http_calls,0);assert.equal(report.evidence_kind,'synthetic_demonstration');assert.equal(report.node_shaping_verified,false);
  assert(report.deliberate_wrong_address.rejected);assert.deepEqual(report.deliberate_wrong_address.reasons,['ANSWER_IDENTITY_OR_UNITS']);
});
test('offline replay preserves a capture and rejects changed bytes against the original hash',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'wallet-proof-replay-'));
  try{
    const fixture=walletProofFixture();fixture.transport=Array.from({length:16},()=>({synthetic:true}));
    const path=join(directory,'capture.json'),bytes=JSON.stringify(fixture);
    await writeFile(path,bytes);await writeFile(path+'.sha256',createHash('sha256').update(bytes).digest('hex'));
    const good=run(['--replay',path]);assert.equal(good.status,0,good.stderr);const report=JSON.parse(good.stdout);
    assert.equal(report.http_calls,0);assert.equal(report.captured_http_calls,16);
    await writeFile(path,bytes+' ');const bad=run(['--replay',path]);assert.notEqual(bad.status,0);assert.match(bad.stderr,/CAPTURE_HASH_CHANGED/);
  }finally{
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(directory.split(/[\\/]/).at(-1),/^wallet-proof-replay-/);
    await rm(directory,{recursive:true,force:true});
  }
});
test('CLI rejects upload, signing and caller-selected RPC origins',()=>{
  for(const args of [['--upload'],['--sign'],['--rpc','http://127.0.0.1'],['--demo','--demo']]){const result=run(args);assert.notEqual(result.status,0);assert.match(result.stderr,/UNSUPPORTED_OR_DUPLICATE_ARGUMENT/);}
});
