import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessWalletProof,numericBalanceWei,walletInput} from '../tools/lib/wallet-proof.mjs';
import {walletProofFixture} from './fixtures/wallet-proof.mjs';

test('correct nonzero capture passes all five fields and reports raw protocol version drift separately',()=>{
  const report=assessWalletProof(walletProofFixture());assert(report.pass);assert.equal(report.reference.balance_wei,'125000000000000000');assert.equal(report.raw_metadata_versions_match_live_contract,false);assert.equal(report.node_shaping_verified,false);
});
test('genuine zero is preserved',()=>{const f=walletProofFixture();f.provider.body.balance=0;f.provider.body.evidence.value_raw='0';for(const r of f.references)r.balance_wei='0x0';f.provider.raw_body=JSON.stringify(f.provider.body);assert(assessWalletProof(f).pass);});
for(const [name,mutate]of [
  ['wrong wallet',f=>f.provider.body.address='0x'+'cd'.repeat(20)],
  ['wrong chain',f=>f.provider.body.chain='base-sepolia'],
  ['wei passed as ETH',f=>f.provider.body.balance=125000000000000000],
  ['wrong token symbol',f=>f.provider.body.token_symbol='USDC'],
  ['reference chain mismatch',f=>f.references[0].chain_id='0x1'],
  ['wrong reference query wallet',f=>f.references[0].query.params[0]='0x'+'cd'.repeat(20)],
  ['noncanonical query',f=>f.references[0].query.params[1].requireCanonical=false],
  ['wrong same-height hash',f=>f.references[0].block.hash='0x'+'34'.repeat(32)],
  ['post-read reorg',f=>f.references[0].canonical_after.hash='0x'+'34'.repeat(32)],
  ['source disagreement',f=>f.references[0].balance_wei='0x1'],
  ['raw provider balance mismatch',f=>f.provider.body.evidence.value_raw='1'],
  ['stale observation',f=>f.checked_at='2026-11-03T16:02:01.000Z'],
  ['future observation',f=>f.checked_at='2026-11-03T15:59:00.000Z'],
  ['stale block',f=>f.provider.body.evidence.block.timestamp='1'],
  ['duplicate declared source',f=>f.references[1].source=f.references[0].source],
  ['RPC error inside HTTP 200',f=>f.references[0].error='RPC_REFUSAL'],
  ['provider timeout',f=>f.provider={status:0,error:'TimeoutError'}],
  ['failed refusal disguised as answer',f=>f.refusals[0]={name:'unsupported_chain',status:200,body:{balance:0}}],
  ['missing refusal control',f=>f.refusals.pop()],
  ['contract unit drift',f=>f.contract.body.response.fields[2].unit='wei'],
  ['negative balance',f=>f.provider.body.balance=-1],
  ['lossy numeric balance',f=>{f.provider.body.evidence.value_raw='125000000000000001';for(const r of f.references)r.balance_wei='0x'+125000000000000001n.toString(16);}],
])test('refuses '+name,()=>{const f=walletProofFixture();mutate(f);if(f.provider.body)f.provider.raw_body=JSON.stringify(f.provider.body);assert.equal(assessWalletProof(f).pass,false);});
test('raw decimal lexemes cannot silently lose one wei through JSON.parse',()=>{
  const f=walletProofFixture();f.provider.body.balance=0.1;f.provider.body.evidence.value_raw='100000000000000000';for(const r of f.references)r.balance_wei='0x'+100000000000000000n.toString(16);
  f.provider.raw_body=JSON.stringify(f.provider.body).replace('"balance":0.1','"balance":0.100000000000000001');
  assert.deepEqual(JSON.parse(f.provider.raw_body),f.provider.body);
  assert.match(assessWalletProof(f).failures[0],/PROVIDER_NUMBER_TOKEN_PRECISION_LOSS/);
});
test('RFC3339 whole seconds are accepted and nonexistent calendar dates are refused',()=>{
  const f=walletProofFixture();f.checked_at=f.checked_at.replace('.000Z','Z');assert(assessWalletProof(f).pass);f.checked_at='2026-02-30T16:00:00Z';assert(!assessWalletProof(f).pass);
});
test('numeric comparison uses decimal text and exact integer wei, including exponents',()=>{assert.equal(numericBalanceWei(1e-18),1n);assert.equal(numericBalanceWei(0.125),125000000000000000n);for(const n of [NaN,Infinity,-0,-1,1e-19])assert.throws(()=>numericBalanceWei(n));});
test('request cannot select another chain, ENS, source URL or unsupported account',()=>{assert.equal(walletInput('base','0x'+'AB'.repeat(20)).address,'0x'+'ab'.repeat(20));for(const [c,a]of [['ethereum','0x'+'ab'.repeat(20)],['base','example.eth'],['https://private','invalid']])assert.throws(()=>walletInput(c,a));});
