import assert from 'node:assert/strict';
export function assertPlacesSmokeBinding(smoke,audit,now=Date.now()){
  assert(smoke.public===false&&smoke.pass===true&&smoke.live_attempts===2&&smoke.live_successes===2,'Successful local workerd city current/forecast smoke required');
  assert(audit.boundary_passed===true&&audit.modules===17,'Current audited bundle required');
  for(const [left,right]of [['bundle_sha256','bundle_sha256'],['data_sha256','source_data_sha256'],['config_sha256','config_sha256']]){
    assert(/^0x[0-9a-f]{64}$/.test(smoke[left]??''),'Missing smoke identity '+left);assert.equal(smoke[left],audit[right],'Smoke identity drift '+left);
  }
  assert.equal(smoke.descriptor_sha256,audit.assets.find(a=>a.file==='referenceforge-places-v2.yaml')?.sha256,'Local smoke descriptor drift');
  const time=Date.parse(smoke.checked_at);assert(Number.isFinite(time)&&time<=now+5000&&now-time<=3600000,'Local smoke is stale or has invalid time');
  return true;
}
