import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {assertV2ReleaseConfig,assertV2AssetSet,assertV2AssetBytes,LEGACY_ASSET_HASHES,V2_ASSET_NAMES,V2_PUBLIC_ORIGIN} from '../tools/lib/v2-release-plan.mjs';
const config=JSON.parse(await readFile(new URL('../deploy/v2.wrangler.jsonc',import.meta.url),'utf8'));
const manifest=()=>({preserved:Object.entries(LEGACY_ASSET_HASHES).map(([file,sha256])=>({file,sha256})),outputs:['referenceforge-v2.yaml','v2-contract-manifest.json'].map(file=>({file,url:V2_PUBLIC_ORIGIN+'/'+file,sha256:'0x'+'ab'.repeat(32)}))});
test('release cannot silently select another account, Worker, entry point, asset directory or runtime date',()=>{
  assert(assertV2ReleaseConfig(config));for(const mutate of [c=>c.account_id='other',c=>c.name='other',c=>c.main='weather-worker.mjs',c=>c.compatibility_date='2026-10-29',c=>c.assets.directory='../research',c=>c.vars={secret:'bad'}]){const c=structuredClone(config);mutate(c);assert.throws(()=>assertV2ReleaseConfig(c));}
});
test('release refuses extra public material, duplicate assets, changed pinned legacy bytes or artifact origin',()=>{
  assert.equal(assertV2AssetSet(V2_ASSET_NAMES,manifest()).length,10);
  assert.throws(()=>assertV2AssetSet([...V2_ASSET_NAMES,'private.json'],manifest()));
  for(const mutate of [p=>p.preserved[0].sha256='0x'+'ff'.repeat(32),p=>p.outputs[0].url='https://other.test/file',p=>p.outputs[1].file=p.outputs[0].file]){const p=manifest();mutate(p);assert.throws(()=>assertV2AssetSet(V2_ASSET_NAMES,p));}
});
test('release hash check refuses modified bytes rather than trusting its manifest alone',()=>{assert.throws(()=>assertV2AssetBytes('miner.yaml',Buffer.from('changed'),LEGACY_ASSET_HASHES['miner.yaml']));});
