import assert from 'node:assert/strict';
import {bytesHash} from './v2-validation.mjs';
export const V2_PUBLIC_ORIGIN='https://referenceforge.0xsaroj001.workers.dev';
export const LEGACY_ASSET_HASHES=Object.freeze({
  'miner.yaml':'0x5a676c4d038e763647772510967de4b381b9e149ac1d93423ad68e8669b12752',
  'referenceforge-unified.yaml':'0x6c1d031c2cc64ad6a57db83c8bb18af5538ef9531df2872b11267ead929d349a',
  'referenceforge-expanded.yaml':'0x95f0c102e41a72d569302a9664ce37e55ccfdce56762018e7f9f0e3823d1e197',
  'referenceforge-expanded-no-fx.yaml':'0xb1aa128c22c904ba6fef49f9d690f6d2f6b2596b5bda4a312a1b486d66c1fcef',
  'referenceforge-weather.yaml':'0xde4f29445f76a1679c832ab19f5d92eaf2e5c56f893528cad329d8fd59641e68',
  'referenceforge-routing.yaml':'0xd3c4ad5864771472bdf51d61930079d6fd4864c04746b7a07659cccb84f57a73',
  'referenceforge-comparator.wasm':'0xc82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507',
  'artifact-manifest.json':'0xca49fd36eb7abdb6a69f66a90bc315477a39626e1825abcd4c31e575d6ac2a9d'
});
export const V2_ASSET_NAMES=Object.freeze([...Object.keys(LEGACY_ASSET_HASHES),'referenceforge-v2.yaml','v2-contract-manifest.json']);
export function assertV2ReleaseConfig(config){
  assert.equal(config.name,'referenceforge');assert.equal(config.account_id,'35b26bd77aa13f5f1c008027783d71ca');assert.equal(config.main,'v2-worker.mjs');
  assert.equal(config.compatibility_date,'2026-10-23');assert.equal(config.assets.directory,'./v2-public');assert.equal(config.assets.binding,'ASSETS');assert.equal(config.assets.run_worker_first,true);
  assert(config.observability.enabled&&config.observability.traces.enabled);assert(!config.vars&&!config.routes&&!config.services&&!config.kv_namespaces&&!config.d1_databases,'Unexpected deployment resources or variables');
  return true;
}
export function assertV2AssetSet(files,prepared){
  assert.deepEqual([...files].sort(),[...V2_ASSET_NAMES].sort(),'Unexpected public asset set');
  const all=[...prepared.preserved,...prepared.outputs];assert.equal(all.length,10);assert.equal(new Set(all.map(x=>x.file)).size,10);
  for(const name of V2_ASSET_NAMES){const row=all.find(x=>x.file===name);assert(row&&/^0x[0-9a-f]{64}$/.test(row.sha256));if(LEGACY_ASSET_HASHES[name])assert.equal(row.sha256,LEGACY_ASSET_HASHES[name],'Legacy asset drift requires review');}
  for(const a of prepared.outputs)assert.equal(a.url,V2_PUBLIC_ORIGIN+'/'+a.file,'Do not change artifact host');
  return all;
}
export function assertV2AssetBytes(file,bytes,expected){assert.equal(bytesHash(bytes),expected,'Changed asset '+file);if(LEGACY_ASSET_HASHES[file])assert.equal(expected,LEGACY_ASSET_HASHES[file]);}
