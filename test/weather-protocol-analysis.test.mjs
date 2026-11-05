import test from 'node:test';
import assert from 'node:assert/strict';
import {protocolSchedule} from '../tools/lib/weather-protocol.mjs';
import {xorshift32,quantileType7,analyzeProtocolRows} from '../tools/lib/weather-protocol-analysis.mjs';
const protocol={protocol_id:'referenceforge-weather-prospective-v1',schedule:{consecutive_utc_days:14,forecast_hours_per_location_per_day:24,capture_window_minutes:15,planned_target_hours:1008},locations:[{name:'A',station:'KAAA',lat:0,lon:0},{name:'B',station:'KBBB',lat:1,lon:1},{name:'C',station:'KCCC',lat:2,lon:2}],baseline:{temperature_quality_flags:['C','S','V','G'],maximum_observation_age_minutes:90},truth:{matching_window_minutes:30}};
const owner='2026-05-01T12:00:00Z',slots=protocolSchedule(protocol,owner),clock={asOf:'2026-05-17T00:00:00Z'};
function fixture(){return slots.flatMap(slot=>protocol.locations.flatMap(location=>Array.from({length:24},(_,hour)=>{const time=new Date(Date.parse(slot)+(hour+1)*3600000).toISOString();return {slot,location:location.name,time,issued_at:slot,station:location.station,quality_control:'V',observed_at:time,forecast_c:21,baseline_c:22,observed_c:20};})));}
const run=rows=>analyzeProtocolRows(protocol,owner,rows,clock);
test('deterministic RNG known outputs and type-7 endpoints/interpolation match fixed conventions',()=>{const rng=xorshift32(1);assert.equal(rng()*4294967296,270369);assert.equal(rng()*4294967296,67634689);assert.equal(quantileType7([10,0],0.025),0.25);assert.equal(quantileType7([0,10],0.975),9.75);assert.equal(quantileType7([3],0.5),3);assert.throws(()=>xorshift32(0));assert.throws(()=>quantileType7([NaN],0.5));});
test('complete synthetic series reports paired improvement with constant day-block interval',()=>{
 const r=run(fixture());assert.equal(r.paired_hours,1008);assert.equal(r.primary_equal_location_mae_difference_c,-1);assert.deepEqual(r.uncertainty.interval_95_c,[-1,-1]);assert.equal(r.directional_evidence_gates_pass,true);assert.equal(r.conclusion,'forecast_lower_absolute_error_in_this_series');assert.equal(r.per_location_lead_time.length,12);assert.equal(r.per_day.length,14);assert.equal(r.per_lead_time[3].paired_hours,0);assert.equal(r.source_ingestion_verified,false);
});
test('worsening, zero-baseline MAE and empty data remain explicit without fake skill',()=>{
 const rows=fixture().map(r=>({...r,forecast_c:23})),r=run(rows);assert.equal(r.conclusion,'forecast_higher_absolute_error_in_this_series');assert.deepEqual(r.uncertainty.interval_95_c,[1,1]);
 const zero=run(fixture().map(r=>({...r,baseline_c:20})));assert.equal(zero.mae_skill,null);
 const empty=run([]);assert.equal(empty.missing_hours,1008);assert.equal(empty.missing_reasons.capture_missing,1008);assert.equal(empty.primary_equal_location_mae_difference_c,null);assert.equal(empty.uncertainty.invalid_draws,10000);assert.equal(empty.uncertainty.interval_95_c,null);assert.equal(empty.conclusion,'insufficient_evidence');assert.equal(empty.lead_unassigned_target_hours,1008);
});
test('sparse one-day data withholds uncertainty and directional claim while preserving all planned hours',()=>{
 const rows=fixture().filter(r=>r.slot===slots[0]),r=run(rows);assert.equal(r.paired_hours,72);assert.equal(r.missing_hours,936);assert(r.uncertainty.invalid_fraction>0.1);assert.equal(r.uncertainty.interval_95_c,null);assert.equal(r.common_paired_days,1);assert.equal(r.conclusion,'insufficient_evidence');assert.deepEqual(run(rows).uncertainty,r.uncertainty);
});
test('primary uses equal location weights; missing lead metadata stays unassigned',()=>{
 const rows=fixture().filter(r=>r.slot===slots[0]&&(r.location!=='A'||r.time===fixture()[0].time)).map(r=>({...r,forecast_c:r.location==='A'?21:24})),r=run(rows);assert.equal(r.primary_equal_location_mae_difference_c,1);assert.equal(r.paired_hours,49);assert.equal(r.lead_unassigned_target_hours,959);assert.equal(r.conclusion,'insufficient_evidence');
 const missing={...fixture()[0],observed_c:null,missing_reason:'temperature_or_quality_unacceptable'};const m=run([missing]);assert.equal(m.per_lead_time[0].missing_hours,1);assert.equal(m.missing_reasons.temperature_or_quality_unacceptable,1);
});
test('joint day uncertainty retains correlated locations and does not manufacture a direction',()=>{
 const r=run(fixture().map(row=>({...row,forecast_c:slots.indexOf(row.slot)<7?21:23})));assert.equal(r.primary_equal_location_mae_difference_c,0);assert(r.uncertainty.interval_95_c[0]<0&&r.uncertainty.interval_95_c[1]>0);assert.equal(r.conclusion,'direction_not_established');
});
test('duplicate/foreign targets, changing baseline/issue, bad observations and immature series refuse',()=>{
 const base=fixture();assert.throws(()=>run([base[0],base[0]]),/Duplicate/);
 for(const mutate of [r=>r.station='KBBB',r=>r.location='unknown',r=>r.time='2026-05-01T00:00:00Z',r=>r.issued_at='2026-05-02T12:59:00Z',r=>r.quality_control='Z',r=>r.observed_at='2026-05-02T13:31:00Z',r=>r.observed_c=NaN]){const r={...base[0]};mutate(r);assert.throws(()=>run([r]));}
 const changed={...base[1],baseline_c:25};assert.throws(()=>run([base[0],changed]),/baseline changed/);assert.throws(()=>run([base[0],{...base[1],issued_at:'2026-05-02T11:00:00Z'}]),/Issue time changed/);assert.throws(()=>analyzeProtocolRows(protocol,owner,base,{asOf:'2026-05-03T00:00:00Z'}),/matured/);
});
