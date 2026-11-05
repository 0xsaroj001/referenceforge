import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {syntheticProtocolFlow} from './fixtures/weather-protocol-flow.mjs';
const originalFetch=globalThis.fetch;
before(()=>{globalThis.fetch=()=>{throw Error('Real network fetch forbidden in synthetic integration');};});
after(()=>{globalThis.fetch=originalFetch;});
test('pinned protocol, metadata, byte semantics, mocked archives and analysis compose without network',async()=>{
  const r=await syntheticProtocolFlow();assert.equal(r.synthetic_fixture_only,true);assert.equal(r.metadata_only_captured_hours,1008);assert.equal(r.artifact_checked_capture_hours,1008);assert.equal(r.mocked_archive_reads,42);assert.equal(r.real_network_calls,0);assert.equal(r.analysis.paired_hours,1008);assert.equal(r.analysis.missing_hours,0);assert.equal(r.analysis.primary_equal_location_mae_difference_c,-1);assert.equal(r.analysis.source_ingestion_verified,false);assert.equal(r.owner_finalization_verified,false);
});
test('metadata success cannot count rejected raw source bytes as verified capture or paired accuracy',async()=>{
  const r=await syntheticProtocolFlow({badArtifactKeys:['0:A']});assert.equal(r.metadata_only_captured_hours,1008);assert.equal(r.artifact_checked_capture_hours,984);assert.equal(r.analysis.paired_hours,984);assert.equal(r.analysis.missing_hours,24);assert.equal(r.mocked_archive_reads,41);assert.equal(r.evidence[0].state,'artifact_rejected');assert.match(r.evidence[0].error,/hash/);assert.equal(r.analysis.missing_reasons.capture_missing,24);
});
test('rejected observations remain missing after valid capture artifacts; zero accepted truth cannot imply skill',async()=>{
  const keys=Array.from({length:14},(_,day)=>['A','B','C'].map(name=>day+':'+name)).flat();
  const r=await syntheticProtocolFlow({badTruthKeys:keys});assert.equal(r.artifact_checked_capture_hours,1008);assert.equal(r.analysis.paired_hours,0);assert.equal(r.analysis.missing_hours,1008);assert.equal(r.analysis.missing_reasons.temperature_or_quality_unacceptable,1008);assert.equal(r.analysis.conclusion,'insufficient_evidence');assert.equal(r.analysis.uncertainty.interval_95_c,null);assert(r.evidence.every(e=>e.state==='truth_missing'));
});
