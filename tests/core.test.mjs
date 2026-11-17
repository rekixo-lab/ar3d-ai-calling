import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {
  checkSlug,normalizeIndianPhone,checkStorageMode,resolveCrmDb,
  inspectLeadDialEligibility,sha256hex
} from '../src/core.mjs';

test('mobile normalization and invalid input',()=>{
  assert.equal(normalizeIndianPhone('98765 43210'),'+919876543210');
  assert.equal(normalizeIndianPhone('+91 9876543210'),'+919876543210');
  assert.throws(()=>normalizeIndianPhone('12345'));
});
test('tenant slug and starter shared-only validation',()=>{
  assert.equal(checkSlug('builder-one'),'builder-one');
  assert.throws(()=>checkSlug('../builder'));
  assert.throws(()=>checkStorageMode('starter','dedicated'));
  assert.deepEqual(checkStorageMode('enterprise','dedicated'),{plan:'enterprise',mode:'dedicated'});
});
test('shared selects only CRM_DB; unprovisioned dedicated fails closed',()=>{
  const shared={prepare(){}};
  assert.equal(resolveCrmDb({CRM_DB:shared},{storage_mode:'shared'}),shared);
  assert.throws(()=>resolveCrmDb({CRM_DB:shared},{storage_mode:'dedicated',dedicated_binding:null}),/dedicated/);
  assert.throws(()=>resolveCrmDb({CRM_DB:shared},{storage_mode:'dedicated',dedicated_binding:'DEDICATED_DB_FOO'}),/not provisioned/);
  const dedicated={prepare(){}};
  assert.equal(resolveCrmDb({DEDICATED_DB_FOO:dedicated},{storage_mode:'dedicated',dedicated_binding:'DEDICATED_DB_FOO'}),dedicated);
});
test('cold/imported leads cannot pass calling precheck',()=>{
  const num={status:'active',compliance_state:'approved'};
  assert.equal(inspectLeadDialEligibility({consent_status:'unknown',dnd_status:'unknown'},num).passedPrecheck,false);
  assert.equal(inspectLeadDialEligibility({consent_status:'granted',consent_proof:'web',consent_at:'2026-11-17',dnd_status:'allowed'},num).passedPrecheck,true);
  assert.equal(inspectLeadDialEligibility({consent_status:'granted',consent_proof:'web',consent_at:'2026-11-17',dnd_status:'allowed'},null).passedPrecheck,false);
});
test('worker never exposes protected endpoints anonymously',async()=>{
  const env={CONTROL_DB:{prepare(){throw Error('no unauthenticated query expected')}}};
  const r=await worker.fetch(new Request('https://call.example/v1/admin/tenants',{method:'POST'}),env);
  assert.equal(r.status,401);
  const h=await worker.fetch(new Request('https://call.example/health'),env);
  assert.equal(h.status,200);
});
test('tenant scoping from token, never chosen from URL parameter',async()=>{
  const key='ar3dca_'+('a'.repeat(64)),hash=await sha256hex(key);
  const tenants={
    [hash]:{tenant_id:'TENANT_A',slug:'tenant-a',display_name:'A',plan_code:'starter',storage_mode:'shared',dedicated_binding:null,status:'active',role:'client_admin'}
  };
  const queries=[];
  const env={
    CONTROL_DB:{prepare(sql){return {bind(...args){return {async first(){return tenants[args[0]]||null}}}}}},
    CRM_DB:{prepare(sql){return {bind(...args){queries.push({sql,args});return {async all(){return {results:[]}}}}}}}
  };
  const r=await worker.fetch(new Request('https://call.example/v1/leads?tenantId=TENANT_B',{headers:{Authorization:'Bearer '+key}}),env);
  assert.equal(r.status,200);
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/WHERE tenant_id=\?/i);
  assert.equal(queries[0].args[0],'TENANT_A');
});
