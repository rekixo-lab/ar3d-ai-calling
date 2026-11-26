import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,setup,route,tid,lead,admin,client,at,now} from './helpers/calling-fixture.mjs';
import {releaseUnusedReservation} from '../src/unused-reservation-recovery.mjs';
import {handleScriptedCallingRequest} from '../src/scripted-campaign-routes.mjs';
import {moneyBudgetConfig,providerBudgetPosition} from '../src/provider-cost-reservations.mjs';
import {minutePosition,closeMinuteHold} from '../src/minute-holds.mjs';

async function failedReservation(f){
 await setup(f);
 const {id}=f.r.db.prepare('SELECT id FROM calling_jobs WHERE tenant_id=?').get(tid);
 f.r.db.prepare(`UPDATE calling_jobs SET state='failed',error_code='credit_reservation_unavailable',
  reserved_at=?,updated_at=?,account_sid='synthetic-account',caller_id='+918000000000',destination='+919000000001'
  WHERE tenant_id=? AND id=?`).run(at,at,tid,id);
 f.r.db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'scripted_campaign','calling.failed',?,?)")
  .run(tid,crypto.randomUUID(),id,at);
 f.c.db.prepare(`INSERT INTO provider_cost_reservations(tenant_id,job_id,reserved_seconds,plivo_currency,
  plivo_micros,sarvam_currency,sarvam_micros,created_at) VALUES(?,?,180,'USD',60000,'INR',600000,?)`).run(tid,id,at);
 return id;
}
const release=(f,id,actor='admin')=>releaseUnusedReservation(f.env,f.r.wrap,{tenantId:tid,jobId:id},actor,now+1000);
function session(f,id){
 f.c.db.prepare(`INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,
  destination,caller,expires_at,phase,survey_json,created_at,provider_account_id,job_id)
  VALUES(?,?,?,?,'admin','hi','+919000000001','+918000000000',?,'requested','{}',?,'synthetic-account',?)`)
  .run(crypto.randomUUID(),tid,lead,at,now+600000,at,id);
}

test('proven pre-submission failure releases only the original hold and both budget commitments, exactly once',async()=>{
 const f=fixture();try{
  const id=await failedReservation(f);
  const jobs=f.r.db.prepare('SELECT * FROM calling_jobs').all();
  const result=await release(f,id);
  assert.deepEqual(result,{ok:true,replayed:false,state:'released',releasedSeconds:180,chargedSeconds:0,callPlaced:false,providerRequests:0});
  assert.deepEqual(await minutePosition(f.c.wrap,tid),{allocatedSeconds:6000,heldSeconds:0,usedSeconds:0,uncommittedSeconds:6000});
  const budget=await providerBudgetPosition(f.c.wrap,moneyBudgetConfig(f.env));
  assert.equal(budget.accounts.every(x=>x.committedMicros===0),true);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_cost_reservations').get().n,1,'reservation history survives');
  assert.deepEqual(f.r.db.prepare('SELECT * FROM calling_jobs').all(),jobs,'never requeues or edits the attempt');
  assert.equal((await release(f,id)).replayed,true);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM tenant_audit_events WHERE action='calling.unused_reservation_released'").get().n,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM scripted_phone_pilots WHERE job_id=?').get(id).n,0);
 }finally{f.close()}
});

test('a missing session alone never releases queued, reserved, submitted, unknown or other failed calls',async()=>{
 for(const [state,error] of [['queued',null],['reserved',null],['submitted',null],['unknown','provider_outcome_uncertain'],['failed','plivo_rejected']]){
  const f=fixture();try{
   const id=await failedReservation(f);
   f.r.db.prepare('UPDATE calling_jobs SET state=?,error_code=? WHERE id=?').run(state,error,id);
   assert.equal((await release(f,id)).state,'no_submission_not_proven');
   assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(id).state,'held');
  }finally{f.close()}
 }
});

test('provider references, callback duration, recorded results or CDR evidence prevent release',async()=>{
 const mutations=[
  f=>f.r.db.exec("UPDATE calling_jobs SET provider_call_sid='synthetic-call'"),
  f=>f.r.db.exec("UPDATE calling_jobs SET provider_status='ended'"),
  f=>f.r.db.exec('UPDATE calling_jobs SET duration_seconds=0'),
  (f,id)=>f.r.db.prepare("INSERT INTO scripted_call_results(tenant_id,job_id,session_id,answers_json,saved_to_lead,captured_at) VALUES(?,?,'synthetic-session','{}',0,?)").run(tid,id,at),
  (f,id)=>f.r.db.prepare("INSERT INTO verified_provider_call_costs(tenant_id,job_id,provider_call_uuid,reported_amount,billed_seconds,call_seconds,verified_by,verified_at) VALUES(?,?,'synthetic-call','0',0,0,'admin',?)").run(tid,id,at),
  (f,id)=>f.r.db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'scripted_campaign','calling.submitted',?,?)").run(tid,crypto.randomUUID(),id,at),
  f=>f.r.db.exec("DELETE FROM crm_audit_events WHERE action='calling.failed'")
 ];
 for(const mutate of mutations){
  const f=fixture();try{const id=await failedReservation(f);mutate(f,id);assert.equal((await release(f,id)).state,'no_submission_not_proven')}
  finally{f.close()}
 }
});

test('existing or concurrently created provider session prevents the atomic release',async()=>{
 for(const racing of [false,true]){
  const f=fixture();try{
   const id=await failedReservation(f);
   if(!racing)session(f,id);
   else{
    const original=f.env.CONTROL_DB;
    f.env.CONTROL_DB={...original,async batch(queries){session(f,id);return original.batch(queries)}};
   }
   assert.equal((await release(f,id)).ok,false);
   assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(id).state,'held');
   assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM tenant_audit_events WHERE action='calling.unused_reservation_released'").get().n,0);
  }finally{f.close()}
 }
});

test('non-admin, another tenant, settled holds and differently released holds cannot be recovered',async()=>{
 const f=fixture();try{
  const id=await failedReservation(f);
  assert.equal((await release(f,id,'client')).state,'super_admin_required');
  assert.equal((await releaseUnusedReservation(f.env,f.r.wrap,{tenantId:'99999999-9999-4999-8999-999999999999',jobId:id},'admin',now)).ok,false);
  await closeMinuteHold(f.c.wrap,{tenantId:tid,job:id,billedSeconds:30,evidenceRef:'synthetic-cdr',kind:'verified_cdr',now});
  assert.equal((await release(f,id)).state,'reservation_changed');
 }finally{f.close()}
 const g=fixture();try{
  const id=await failedReservation(g);
  await closeMinuteHold(g.c.wrap,{tenantId:tid,job:id,billedSeconds:0,evidenceRef:'other-no-submission-evidence',kind:'verified_no_submission',now});
  assert.equal((await release(g,id)).state,'reservation_changed');
 }finally{g.close()}
});

test('audit failure rolls back release and malformed recovery identities are rejected',async()=>{
 const f=fixture();try{
  const id=await failedReservation(f);
  f.c.db.exec("CREATE TRIGGER synthetic_recovery_audit_failure BEFORE INSERT ON tenant_audit_events WHEN NEW.action='calling.unused_reservation_released' BEGIN SELECT RAISE(ABORT,'synthetic audit failed'); END;");
  await assert.rejects(release(f,id),/synthetic audit failed/);
  assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(id).state,'held');
  await assert.rejects(release(f,'not-a-job'),/invalid unused reservation recovery/);
 }finally{f.close()}
});

test('recovery route requires Super Admin, current MFA, same origin and an exact POST selection',async t=>{
 let providerRequests=0;
 t.mock.method(globalThis,'fetch',async()=>{providerRequests++;throw Error('recovery must not request providers')});
 const f=fixture();try{
  const id=await failedReservation(f),data={tenantId:tid,jobId:id},action='release-unused-reservation';
  const snapshot=f.c.db.prepare('SELECT * FROM tenant_minute_holds WHERE job_id=?').get(id);
  const rejected=async(response,status)=>assert.equal((await response).status,status);
  await rejected(route(f,action,data,client),403);
  await rejected(route(f,action,data,{id:'viewer',globalRole:'user'}),403);
  await rejected(route(f,action,data,admin,'GET'),405);
  for(const from of ['https://other.invalid','null']){
   const req=new Request('https://app.example.invalid/v1/human/calling/'+action,{
    method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(data)});
   await rejected(handleScriptedCallingRequest(req,f.env,admin,{now}),403);
  }
  for(const invalid of [{...data,force:true},{...data,jobId:'bad'}, {tenantId:tid},
   {...data,tenantId:'bad'},{...data,evidenceReference:'operator override'}])
   await rejected(route(f,action,invalid,admin),400);
  const queryRequest=new Request('https://app.example.invalid/v1/human/calling/'+action+'?force=1',{
   method:'POST',headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},body:JSON.stringify(data)});
  await rejected(handleScriptedCallingRequest(queryRequest,f.env,admin,{now}),400);
  for(const invalidate of [
   ()=>f.c.db.prepare('UPDATE human_sessions SET created_at=?').run(new Date(now-1).toISOString()),
   ()=>f.c.db.prepare('UPDATE human_sessions SET expires_at=?').run(now),
   ()=>f.c.db.prepare('UPDATE human_sessions SET revoked_at=?').run(at)
  ]){
   f.c.db.prepare('UPDATE human_sessions SET created_at=?,expires_at=?,revoked_at=NULL').run(at,now+86400000);
   invalidate();
   await rejected(route(f,action,data,admin),403);
  }
  assert.deepEqual(f.c.db.prepare('SELECT * FROM tenant_minute_holds WHERE job_id=?').get(id),snapshot);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM tenant_audit_events WHERE action='calling.unused_reservation_released'").get().n,0);
  assert.equal(providerRequests,0);
 }finally{f.close()}
});

test('authenticated recovery route releases once, reports replay, and never calls or requeues',async t=>{
 let providerRequests=0;
 t.mock.method(globalThis,'fetch',async()=>{providerRequests++;throw Error('recovery must not request providers')});
 const f=fixture();try{
  const id=await failedReservation(f),data={tenantId:tid,jobId:id},action='release-unused-reservation';
  const jobs=f.r.db.prepare('SELECT * FROM calling_jobs').all(),runs=f.r.db.prepare('SELECT * FROM calling_runs').all();
  const sessions=f.c.db.prepare('SELECT COUNT(*) n FROM scripted_phone_pilots').get().n;
  const response=await route(f,action,data,admin);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{ok:true,replayed:false,state:'released',releasedSeconds:180,
   chargedSeconds:0,callPlaced:false,providerRequests:0});
  const replay=await route(f,action,data,admin);
  assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM tenant_audit_events WHERE action='calling.unused_reservation_released'").get().n,1);
  assert.deepEqual(f.r.db.prepare('SELECT * FROM calling_jobs').all(),jobs);
  assert.deepEqual(f.r.db.prepare('SELECT * FROM calling_runs').all(),runs);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM scripted_phone_pilots').get().n,sessions);
  assert.equal(providerRequests,0);
 }finally{f.close()}
});

test('recovery route returns conflict when pre-submission evidence is absent and cannot cross tenant scope',async()=>{
 const f=fixture();try{
  const id=await failedReservation(f),action='release-unused-reservation';
  const other='99999999-9999-4999-8999-999999999999';
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other','starter','shared','active',?,?)").run(other,at,at);
  const wrong=await route(f,action,{tenantId:other,jobId:id},admin);
  assert.equal(wrong.status,409);assert.equal((await wrong.json()).error,'no_submission_not_proven');
  f.r.db.prepare("UPDATE calling_jobs SET state='unknown',error_code='provider_outcome_uncertain' WHERE id=?").run(id);
  const unknown=await route(f,action,{tenantId:tid,jobId:id},admin);
  assert.equal(unknown.status,409);assert.equal((await unknown.json()).error,'no_submission_not_proven');
  assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(id).state,'held');
 }finally{f.close()}
});
