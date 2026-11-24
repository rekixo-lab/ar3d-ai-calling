import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,now,at,until,admin,client,route,setup,accepted} from './helpers/calling-fixture.mjs';
import {scriptedCampaignConfiguration,inCallingWindow,runScriptedCampaignCron,tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';
import {approvedCampaignPhone,SCRIPTED_CALLING_POLICY} from '../src/scripted-phone-pilot.mjs';
async function tickTenant(env,db,tid,options){
 return tickScriptedTenant(env,db,tid,await approvedCampaignPhone(env),options);
}
test('migrated database: admin approval → client start → exactly one Plivo dispatch → verified status',async()=>{
 const f=fixture();try{
 await setup(f);let posted=0;
 const send=async (url,options)=>{
  posted++;assert.match(url,/api\.plivo\.com/);assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);assert.equal(body.to,'+919000000001');
  assert.match(body.answer_url,/\/v1\/provider\/plivo\/scripted-pilot\/[^/]+\/answer$/);
  return accepted();
 };
 const out=await Promise.all([tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:send}),tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:send})]);
 assert.equal(posted,1);assert.ok(out.some(x=>x.state==='submitted'));
 f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='completed',hangup_at=?,duration_seconds=37 WHERE job_id IS NOT NULL").run(now+37000);
 const result=await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:()=>assert.fail('must reconcile without redial')});
 assert.equal(result.state,'reconciled');assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs').get().state,'completed');
 await tickTenant(f.env,f.r.wrap,tid,{now:now+120000,apiFetch:send});assert.equal(f.r.db.prepare('SELECT state FROM calling_runs').get().state,'completed');
 await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'});await tickTenant(f.env,f.r.wrap,tid,{now:now+180000,apiFetch:send});assert.equal(posted,1);
 const state=await (await route(f,'state',{tenantId:tid},client,'GET')).json();assert.equal(state.jobs[0].durationSeconds,37);assert.doesNotMatch(JSON.stringify(state),/CAfictional|fictionaltoken|9000000001/);
 }finally{f.close()}
});
test('timeout/5xx/invalid provider responses never redial; uncertain job locks next dispatch',async()=>{
 for(const provider of [async()=>{throw Error('timeout')},async()=>new Response('upstream failure',{status:503}),async()=>Response.json({Call:{Sid:'wrong'}})]){
 const f=fixture();try{await setup(f);let calls=0;const send=async(...args)=>{calls++;return provider(...args)};
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:send})).state,'unknown');
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:send})).state,'waiting_or_locked');assert.equal(calls,1);
 }finally{f.close()}}
});
test('pause, expiry, kill switch and hours prevent dispatch; opt-out blocks queued customer',async()=>{
 for(const condition of ['pause','expiry','kill','hours','optout','clearance']){
 const f=fixture();try{await setup(f);let when=now;
 if(condition==='pause')await route(f,'runs',{tenantId:tid,campaignId:cid,action:'pause'});
 if(condition==='expiry')f.r.db.exec("UPDATE calling_policies SET expires_at='2000-01-01T00:00:00.000Z'");
 if(condition==='kill')f.env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED='disabled';
 if(condition==='hours')when=Date.parse('2026-11-20T17:00:00Z');
 if(condition==='optout')f.r.db.exec("UPDATE leads SET consent_status='denied',dnd_status='blocked'");
 if(condition==='clearance')f.r.db.exec('DELETE FROM calling_clearances');
 let calls=0;await tickTenant(f.env,f.r.wrap,tid,{now:when,apiFetch:async()=>{calls++;return accepted()}});assert.equal(calls,0,condition);
 }finally{f.close()}}
});
test('client/viewer/cross-tenant cannot grant approvals or start another company',async()=>{
 const f=fixture();try{
 assert.equal((await route(f,'policy',{tenantId:tid},client)).status,403);
 assert.equal((await route(f,'clearances',{tenantId:tid},client)).status,403);
 assert.equal((await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'},{id:'viewer',globalRole:'user'})).status,403);
 assert.equal((await route(f,'runs',{tenantId:'99999999-9999-4999-8999-999999999999',campaignId:cid,action:'start'})).status,403);
 f.c.db.exec('DELETE FROM human_mfa_settings');assert.equal((await route(f,'policy',{tenantId:tid},admin)).status,403);
 }finally{f.close()}
});
test('cron kill switch touches no database; Indian window boundary is explicit',async()=>{
 assert.deepEqual(await runScriptedCampaignCron({}),{processed:0});assert.equal((await scriptedCampaignConfiguration({})).ready,false);
 assert.equal(inCallingWindow(Date.parse('2026-11-20T03:30:00Z')),true);
 assert.equal(inCallingWindow(Date.parse('2026-11-20T14:30:00Z')),false);
});
test('daily cap is atomic and failed attempts consume quota',async()=>{
 const f=fixture();try{
 await setup(f);f.r.db.exec('UPDATE calling_policies SET daily_limit=1');
 await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('',{status:400})});
 const second='44444444-4444-4444-8444-444444444444';
 f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Second fictional','+919000000002','excel',?,?)").run(tid,second,at,at);
 f.r.db.prepare("INSERT INTO calling_clearances SELECT tenant_id,?,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at FROM calling_clearances WHERE lead_id=?").run(second,lead);
 const run=f.r.db.prepare('SELECT id FROM calling_runs').get();
 f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,flow_id,created_at,updated_at) VALUES(?,'second-job',?,?,'queued',?,?,?)").run(tid,run.id,second,SCRIPTED_CALLING_POLICY,at,at);
 let posted=0;assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async()=>{posted++;return accepted()}})).state,'quota_or_concurrent_change');
 assert.equal(posted,0);assert.equal(f.r.db.prepare("SELECT state FROM calling_jobs WHERE id='second-job'").get().state,'queued');
 }finally{f.close()}
});
test('a second campaign cannot recontact a customer on stale approval',async()=>{
 const f=fixture();try{
 await setup(f);await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('',{status:400})});
 const another='55555555-5555-4555-8555-555555555555';
 f.r.db.prepare("INSERT INTO call_campaign_drafts SELECT tenant_id,?,'Second campaign',language_mode,purpose,status,created_by,created_at,updated_at FROM call_campaign_drafts WHERE id=?").run(another,cid);
 f.r.db.prepare('INSERT INTO call_campaign_candidates VALUES(?,?,?,?)').run(tid,another,lead,at);
 assert.equal((await route(f,'runs',{tenantId:tid,campaignId:another,action:'start'})).status,202);
 let posted=0;await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async()=>{posted++;return accepted()}});
 assert.equal(posted,0);assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='queued'").get().n,1);
 }finally{f.close()}
});
test('only reviewed policy activation promotes a trial tenant, without touching other tenants',async()=>{
 const f=fixture();try{
 f.c.db.exec("UPDATE tenants SET status='trial'");
 await setup(f);assert.equal(f.c.db.prepare('SELECT status FROM tenants').get().status,'active');
 assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='tenant.calling_activated'").get().n,1);
 }finally{f.close()}
});

test('an uncertain dial stays locked until a Super Admin verifies and closes the paused attempt', async()=>{
 const f=fixture();
 try{
  await setup(f);
  assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>{throw Error('timeout')}})).state,'unknown');
  const {locked}=await (await route(f,'reconcile',{tenantId:tid},admin,'GET')).json();
  assert.equal(locked.canClose,0);
  const payload={tenantId:tid,jobId:locked.id,evidenceReference:'carrier-final-log-checked'};
  assert.equal((await route(f,'reconcile',payload,client)).status,403);
  assert.equal((await route(f,'reconcile',payload,admin)).status,409);
  await route(f,'runs',{tenantId:tid,campaignId:cid,action:'pause'});
  f.r.db.prepare('UPDATE calling_jobs SET reserved_at=? WHERE id=?').run(new Date(now-31*60000).toISOString(),locked.id);
  assert.equal((await route(f,'reconcile',payload,admin)).status,200);
  assert.equal((await route(f,'reconcile',payload,admin)).status,409);
  const job=f.r.db.prepare('SELECT state,error_code FROM calling_jobs WHERE id=?').get(locked.id);
  assert.equal(job.state,'failed');
  assert.equal(job.error_code,'closed_after_carrier_review');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='calling.carrier_reviewed'").get().n,1);
  await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'});
  await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:()=>assert.fail('never redial the closed attempt')});
 }finally{f.close()}
});

test('dispatch refuses absent funding approval or insufficient credits without provider POST',async()=>{
 for(const mode of ['approval','balance']){
  const f=fixture();try{await setup(f);
   if(mode==='approval')delete f.env.AR3D_FUNDED_CAMPAIGN_DISPATCH;
   else f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('recovery',?,'recovery',-6000,6000,0,'admin','Synthetic full recovery',?)").run(tid,at);
   const result=await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:()=>assert.fail('no provider call')});
   assert.equal(result.state,mode==='approval'?'funding_approval_required':'insufficient_credits');
   assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs').get().state,'queued');
   assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,0);
  }finally{f.close()}
 }
});
test('provider POST is preceded by held minutes; definite rejection releases and unknown remains held',async()=>{
 for(const reject of [true,false]){
  const f=fixture();try{await setup(f);
   await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>{
    const hold=f.c.db.prepare('SELECT state,reserved_seconds FROM tenant_minute_holds').get();
    assert.equal(hold.state,'held');assert.equal(hold.reserved_seconds,180);
    if(reject)return new Response('',{status:400});throw Error('ambiguous');
   }});
   const hold=f.c.db.prepare('SELECT state,charged_seconds FROM tenant_minute_holds').get();
   assert.equal(hold.state,reject?'released':'held');assert.equal(hold.charged_seconds,reject?0:null);
  }finally{f.close()}
 }
});

test('dispatch blocks when shared funding cap is exhausted, despite allocated client minutes',async()=>{
 const f=fixture();try{await setup(f);f.env.AR3D_FUNDED_CUMULATIVE_SECONDS='60';
 const result=await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:()=>assert.fail('must not dial')});
 assert.equal(result.state,'provider_funding_exhausted');assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs').get().state,'queued');
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,0);
 delete f.env.AR3D_FUNDED_CUMULATIVE_SECONDS;
 assert.equal((await scriptedCampaignConfiguration(f.env)).ready,false);
 }finally{f.close()}
});
