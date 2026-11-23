import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid,cid,lead,at} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';

const base='https://calling.example.test',other='77777777-7777-4777-8777-777777777777';
const run='eeeeeeee-1111-4111-8111-111111111111';
const lead2='eeeeeeee-2222-4222-8222-222222222222';
const lead3='eeeeeeee-3333-4333-8333-333333333333';
const job1='eeeeeeee-4444-4444-8444-444444444444';
const job2='eeeeeeee-5555-4555-8555-555555555555';
const job3='eeeeeeee-6666-4666-8666-666666666666';
function request(token,tenant=tid,method='GET',query=''){
 return new Request(base+'/v1/human/operations/report?tenantId='+tenant+query,{
  method,headers:{
   ...(token?{cookie:COOKIE+'='+token}:{}),
   ...(method!=='GET'?{origin:base}:{}),
  }
 });
}
function seed(f){
 f.r.db.prepare('UPDATE leads SET consent_status=? WHERE tenant_id=? AND id=?').run('denied',tid,lead);
 for(const [id,name,mobile] of [[lead2,'Second synthetic','+919000000002'],[lead3,'Third synthetic','+919000000003']]){
  f.r.db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
    VALUES(?,?,?,?,'excel',?,?)`).run(tid,id,name,mobile,at,at);
 }
 f.r.db.prepare("UPDATE leads SET interest_status='interested' WHERE tenant_id=? AND id=?").run(tid,lead2);
 f.r.db.prepare("UPDATE leads SET interest_status='followup',followup_at=? WHERE tenant_id=? AND id=?").run(new Date(Date.now()-60000).toISOString(),tid,lead3);
 f.r.db.prepare(`INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at)
  VALUES(?,?,?,'running','client',?,?)`).run(tid,run,cid,at,at);
 const writeJob=f.r.db.prepare(`INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?)`);
 for(const [id,who,state] of [[job1,lead,'unknown'],[job2,lead2,'failed'],[job3,lead3,'queued']]){
  writeJob.run(tid,id,run,who,state,at,at);
 }
 f.r.db.prepare(`INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at)
  VALUES(?,?,?,?,'requested',?)`).run(tid,'eeeeeeee-7777-4777-8777-777777777777',
    lead,new Date(Date.now()+86400000).toISOString(),at);
 const writeAudit=f.r.db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
  VALUES(?,?,'human:client',?,?,?)`);
 writeAudit.run(tid,'eeeeeeee-8888-4888-8888-888888888888','lead.ai_test_auto_saved',lead,new Date().toISOString());
 writeAudit.run(tid,'eeeeeeee-9999-4999-8999-999999999999','lead.opted_out',lead,new Date().toISOString());
 writeAudit.run(tid,'eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa','lead.created',lead,'2020-01-01T00:00:00.000Z');
 f.c.db.prepare(`INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
  VALUES(?,'other-ops','Other Operations','starter','shared','active',?,?)`).run(other,at,at);
}

test('operations report exposes only tenant aggregates, flags unknown provider outcomes and never writes',async()=>{
 const f=fixture();
 try{
  seed(f);
  const token=await newSession(f.env.CONTROL_DB,'client');
  const prior=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const res=await worker.fetch(request(token),f.env);
  assert.equal(res.status,200,await res.clone().text());
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  assert.equal(res.headers.get('referrer-policy'),'no-referrer');
  const data=await res.json();
  assert.equal(data.tenantId,tid);
  assert.deepEqual(data.customers,{total:3,blockedOrDenied:1});
  assert.equal(data.leadPipeline.interested,1);
  assert.equal(data.leadPipeline.followup,1);
  assert.equal(data.leadPipeline.dueFollowups,1);
  assert.equal(data.leadPipeline.not_interested,0);
  assert.equal(data.campaigns.running,1);
  assert.equal(data.visits.requested,1);
  assert.equal(data.jobs.unknown,1);
  assert.equal(data.jobs.failed,1);
  assert.equal(data.jobs.queued,1);
  assert.equal(data.jobs.completed,0);
  assert.equal(data.providerReview.needsManualReconciliation,true);
  assert.match(data.providerReview.notice,/No automatic retry/);
  assert.equal(data.recentActivity.simulatedCrmAutoSaves,1);
  assert.equal(data.recentActivity.optOutEvents,1);
  assert.equal(data.recentActivity.auditEvents,2);
  assert.equal(Date.parse(data.period.to)-Date.parse(data.period.from),7*86400000);
  assert.equal(data.customerCallsStartedByReport,0);
  assert.equal(data.crmWritesByReport,0);
  assert.equal(data.paidUsageVerified,false);
  const raw=JSON.stringify(data);
  for(const secret of ['Fictional buyer','Second synthetic','900000000001','900000000002','human:client'])
   assert.ok(!raw.includes(secret),'report leaked '+secret);
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,prior);
  assert.equal(f.r.db.prepare("SELECT state FROM calling_jobs WHERE id=?").get(job1).state,'unknown');
 }finally{f.close()}
});

test('viewer may read only own aggregate report; foreign tenant and suspended membership fail closed',async()=>{
 const f=fixture();
 try{
  seed(f);
  const viewer=await newSession(f.env.CONTROL_DB,'viewer');
  const own=await worker.fetch(request(viewer),f.env);
  assert.equal(own.status,200);
  assert.equal((await own.json()).customers.total,3);
  assert.equal((await worker.fetch(request(viewer,other),f.env)).status,403);
  f.c.db.prepare("UPDATE tenant_memberships SET status='disabled' WHERE tenant_id=? AND user_id='viewer'")
   .run(tid);
  assert.equal((await worker.fetch(request(viewer),f.env)).status,403);
  f.c.db.prepare("UPDATE tenants SET suspended_from_status=status,status='suspended' WHERE id=?").run(tid);
  const owner=await newSession(f.env.CONTROL_DB,'client');
  assert.equal((await worker.fetch(request(owner),f.env)).status,403);
 }finally{f.close()}
});

test('report has strict GET/query/auth protection and cannot be used as a calling action',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  assert.equal((await worker.fetch(request(null),f.env)).status,401);
  assert.equal((await worker.fetch(request(token,tid,'POST'),f.env)).status,405);
  for(const query of ['&action=retry','&limit=10000','&tenantId='+other])
   assert.equal((await worker.fetch(request(token,tid,'GET',query),f.env)).status,400);
  assert.equal((await worker.fetch(request(token,'not-a-uuid'),f.env)).status,400);
  const count=f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events').get().n;
  assert.equal(count,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});

test('report handles an unavailable CRM without changing scheduled work or granting any access',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  const response=await worker.fetch(request(token),{...f.env,CRM_DB:null});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'CRM not provisioned');
 }finally{f.close()}
});
