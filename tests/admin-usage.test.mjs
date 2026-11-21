import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,at} from './helpers/calling-fixture.mjs';
import {enrichAdminTenantsWithUsage} from '../src/admin-usage.mjs';

const t2='44444444-4444-4444-8444-444444444444';
test('Super Admin report aggregates only its own tenant; completion is not transcript confirmation',async()=>{
 const f=fixture();
 try{
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'builder-two','Builder Two','starter','shared','trial',?,?)").run(t2,at,at);
  f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Buyer B','+919000000009','excel',?,?)").run(t2,'55555555-5555-4555-8555-555555555555',at,at);
  f.r.db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'user','leads.xlsx_import','1',?)").run(tid,'66666666-6666-4666-8666-666666666666',at);
  f.r.db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'user','leads.csv_import','200',?)").run(t2,'77777777-7777-4777-8777-777777777777',at);
  f.r.db.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','user',?,?)").run(tid,'88888888-8888-4888-8888-888888888888',cid,at,at);
  f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,provider_call_sid,provider_status,duration_seconds,reserved_at,created_at,updated_at) VALUES(?,?,?,?,'completed','CAfake','completed',120,?,?,?)").run(tid,'99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888',lead,at,at,at);
  const r=await enrichAdminTenantsWithUsage(f.env,[{id:tid,storage_mode:'shared'},{id:t2,storage_mode:'shared'}]);
  assert.deepEqual(r[0].usage,{customers:1,uploads:1,importedRows:1,reservedAttempts:1,
    providerAccepted:1,providerCompletedWithDuration:1,completedSeconds:120,uncertain:0});
  assert.deepEqual(r[1].usage,{customers:1,uploads:1,importedRows:200,reservedAttempts:0,
    providerAccepted:0,providerCompletedWithDuration:0,completedSeconds:0,uncertain:0});
  assert.equal(r[1].usageAvailable,true);
 }finally{f.close()}
});
test('Dedicated or missing CRM reports unknown, never fabricated zero usage',async()=>{
 const f=fixture();
 try{
  const d=await enrichAdminTenantsWithUsage(f.env,[{id:tid,storage_mode:'dedicated'}]);
  assert.equal(d[0].usageAvailable,false);
  assert.equal(d[0].usage,null);
  const absent=await enrichAdminTenantsWithUsage({...f.env,CRM_DB:null},[{id:tid,storage_mode:'shared'}]);
  assert.equal(absent[0].usageAvailable,false);
  assert.equal(absent[0].usage,null);
 }finally{f.close()}
});
