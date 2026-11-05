// Pure analysis of supplied normalized rows. Does not fetch or authenticate source data.
import assert from 'node:assert/strict';
import {protocolSchedule,validateProtocol} from './weather-protocol.mjs';
const HOUR=3600000,SEED=20261028,DRAWS=10000;
const instant=x=>{assert(typeof x==='string'&&Number.isFinite(Date.parse(x)),'Invalid analysis timestamp');return Date.parse(x);};
const temp=x=>typeof x==='number'&&Number.isFinite(x)&&x>=-100&&x<=70;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function xorshift32(seed){assert(Number.isInteger(seed)&&seed>0&&seed<=0xffffffff,'Invalid nonzero uint32 seed');let state=seed>>>0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};}
export function quantileType7(values,p){assert(values.length&&values.every(Number.isFinite)&&Number.isFinite(p)&&p>=0&&p<=1,'Invalid quantile input');const a=[...values].sort((a,b)=>a-b),h=(a.length-1)*p,i=Math.floor(h);return a[i]+(h-i)*(a[Math.min(i+1,a.length-1)]-a[i]);}
function metric(rows){const forecast=rows.map(r=>r.forecast_c-r.observed_c),baseline=rows.map(r=>r.baseline_c-r.observed_c),mae=mean(forecast.map(Math.abs)),baselineMAE=mean(baseline.map(Math.abs));return {paired_hours:rows.length,forecast_mae_c:mae,persistence_mae_c:baselineMAE,forecast_rmse_c:rows.length?Math.sqrt(mean(forecast.map(x=>x*x))):null,persistence_rmse_c:rows.length?Math.sqrt(mean(baseline.map(x=>x*x))):null,forecast_bias_c:mean(forecast),mae_skill:baselineMAE>0?1-mae/baselineMAE:null};}
function equalLocationDifference(table){const values=table.map(x=>x.count?x.sum/x.count:null);return values.some(x=>x===null)?null:mean(values);}
export function analyzeProtocolRows(protocol,finalizationVerifiedAt,rows,{asOf}={}){
  validateProtocol(protocol);const slots=protocolSchedule(protocol,finalizationVerifiedAt),locations=protocol.locations.map(x=>x.name);
  assert(instant(asOf)>=instant(slots.at(-1))+25*HOUR,'Full series and final archive delay have not matured');
  assert(Array.isArray(rows)&&rows.length<=1008,'Too many analysis rows');
  const lookup=new Map(),dayDesign=new Map(),reasons=['capture_missing','baseline_missing','archive_incomplete','no_nearby_report','temperature_or_quality_unacceptable'];
  for(const row of rows){
    const slot=new Date(instant(row.slot)).toISOString(),time=instant(row.time),offset=(time-instant(slot))/HOUR;
    assert(slots.includes(slot)&&locations.includes(row.location)&&Number.isInteger(offset)&&offset>=1&&offset<=24,'Row outside fixed targets');
    const key=[slot,row.location,time].join('|');assert(!lookup.has(key),'Duplicate target row');
    const issued=row.issued_at===null||row.issued_at===undefined?null:instant(row.issued_at);
    assert(issued===null||(issued<time&&issued<=instant(slot)+15*60000),'Issue time must be available in capture window before target');
    const paired=row.observed_c!==null&&row.observed_c!==undefined;
    if(paired){assert(temp(row.observed_c)&&temp(row.forecast_c)&&temp(row.baseline_c)&&issued!==null&&!row.missing_reason,'Invalid paired temperatures/design');assert(['C','S','V','G'].includes(row.quality_control)&&Math.abs(instant(row.observed_at)-time)<=HOUR/2,'Invalid matched observation');assert(row.station===protocol.locations.find(x=>x.name===row.location).station,'Changed truth station');}
    else assert(reasons.includes(row.missing_reason),'Missing target requires explicit reason');
    const designKey=slot+'|'+row.location,design=dayDesign.get(designKey)??{issued:null,baseline:null};
    if(issued!==null){assert(design.issued===null||design.issued===issued,'Issue time changed within location-day');design.issued=issued;}
    if(paired){assert(design.baseline===null||design.baseline===row.baseline_c,'Persistence baseline changed within location-day');design.baseline=row.baseline_c;}
    dayDesign.set(designKey,design);lookup.set(key,{...row,slot,time:new Date(time).toISOString(),paired,lead_hours:issued===null?null:(time-issued)/HOUR});
  }
  const all=[];
  for(const slot of slots)for(const location of locations)for(let hour=1;hour<=24;hour++){const time=instant(slot)+hour*HOUR;all.push(lookup.get([slot,location,time].join('|'))??{slot,location,time:new Date(time).toISOString(),paired:false,lead_hours:null,missing_reason:'capture_missing'});}
  const pairs=all.filter(r=>r.paired),perLocation=locations.map(location=>{const p=pairs.filter(r=>r.location===location);return {location,planned_hours:336,missing_hours:336-p.length,coverage_fraction:p.length/336,...metric(p)};});
  const leadBin=lead=>lead===null?null:lead<=6?0:lead<=12?1:lead<=24?2:3;
  const leadTime=[{lower_exclusive:0,upper_inclusive:6},{lower_exclusive:6,upper_inclusive:12},{lower_exclusive:12,upper_inclusive:24},{lower_exclusive:24,upper_inclusive:null}].map((bin,index)=>{const group=all.filter(r=>leadBin(r.lead_hours)===index);return {...bin,known_target_hours:group.length,missing_hours:group.filter(r=>!r.paired).length,...metric(group.filter(r=>r.paired))};});
  const dayTables=slots.map(slot=>locations.map(location=>{const p=pairs.filter(r=>r.slot===slot&&r.location===location);return {count:p.length,sum:p.reduce((n,r)=>n+Math.abs(r.forecast_c-r.observed_c)-Math.abs(r.baseline_c-r.observed_c),0)};}));
  const primary=equalLocationDifference(locations.map((_,i)=>dayTables.reduce((n,day)=>({count:n.count+day[i].count,sum:n.sum+day[i].sum}),{count:0,sum:0})));
  const rng=xorshift32(SEED),replicates=[];let invalid=0;
  for(let draw=0;draw<DRAWS;draw++){const totals=locations.map(()=>({count:0,sum:0}));for(let block=0;block<14;block++){const day=dayTables[Math.floor(rng()*14)];for(let i=0;i<3;i++){totals[i].count+=day[i].count;totals[i].sum+=day[i].sum;}}const value=equalLocationDifference(totals);if(value===null)invalid++;else replicates.push(value);}
  const ci=invalid/DRAWS<=0.1&&replicates.length?[quantileType7(replicates,0.025),quantileType7(replicates,0.975)]:null;
  const commonDays=dayTables.filter(day=>day.every(x=>x.count>0)).length,coverage=perLocation.every(x=>x.coverage_fraction>=0.8),eligible=commonDays>=10&&coverage&&ci!==null;
  const conclusion=!eligible?'insufficient_evidence':ci[1]<0?'forecast_lower_absolute_error_in_this_series':ci[0]>0?'forecast_higher_absolute_error_in_this_series':'direction_not_established';
  const missingCounts=Object.fromEntries(reasons.map(reason=>[reason,all.filter(r=>!r.paired&&r.missing_reason===reason).length]));
  const perLocationLead=locations.flatMap(location=>leadTime.map((bin,index)=>{const group=all.filter(r=>r.location===location&&leadBin(r.lead_hours)===index);return {location,lower_exclusive:bin.lower_exclusive,upper_inclusive:bin.upper_inclusive,known_target_hours:group.length,missing_hours:group.filter(r=>!r.paired).length,...metric(group.filter(r=>r.paired))};}));
  const perDay=slots.map(slot=>{const count=pairs.filter(r=>r.slot===slot).length;return {slot,planned_hours:72,paired_hours:count,missing_hours:72-count};});
  const uses=new Map();for(const row of pairs){const key=row.station+'|'+new Date(instant(row.observed_at)).toISOString();uses.set(key,(uses.get(key)??0)+1);}
  return {planned_target_hours:1008,missing_hours:1008-pairs.length,coverage_fraction:pairs.length/1008,...metric(pairs),primary_equal_location_mae_difference_c:primary,per_location:perLocation,per_lead_time:leadTime,per_location_lead_time:perLocationLead,per_day:perDay,reused_observations:[...uses].filter(([,count])=>count>1).map(([key,count])=>({station_and_timestamp:key,uses:count})),lead_unassigned_target_hours:all.filter(r=>r.lead_hours===null).length,missing_reasons:missingCounts,common_paired_days:commonDays,uncertainty:{method:'paired scheduled-day blocks, jointly across locations',rng:'xorshift32 unsigned output / 2^32',seed:SEED,draws:DRAWS,invalid_draws:invalid,invalid_fraction:invalid/DRAWS,percentile_convention:'type 7 linear interpolation',interval_95_c:ci},directional_evidence_gates_pass:eligible,conclusion,source_ingestion_verified:false,scope:'Analysis of supplied normalized inputs only. No raw source provenance, actual collection, routing, Telegraph score or general forecast superiority is established. Fourteen daily blocks may retain cross-day dependence; this interval is not guaranteed calibration.'};
}
