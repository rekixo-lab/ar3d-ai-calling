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
test('no per-company daily cap: prepaid minutes are the only volume limit',async()=>{
 const f=fixture();try{
 await setup(f);f.r.db.exec('UPDATE calling_policies SET daily_limit=1');
 await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('',{status:400})});
 const second='44444444-4444-4444-8444-444444444444';
 f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Second fictional','+919000000002','excel',?,?)").run(tid,second,at,at);
 f.r.db.prepare("INSERT INTO calling_clearances SELECT tenant_id,?,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at FROM calling_clearances WHERE lead_id=?").run(second,lead);
 const run=f.r.db.prepare('SELECT id FROM calling_runs').get();
 f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,flow_id,created_at,updated_at) VALUES(?,'cccccccccccccccccccccccccccccccc',?,?,'queued',?,?,?)").run(tid,run.id,second,SCRIPTED_CALLING_POLICY,at,at);
 let posted=0;assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async()=>{posted++;return accepted()}})).state,'submitted');
 assert.equal(posted,1);assert.equal(f.r.db.prepare("SELECT state FROM calling_jobs WHERE id='cccccccccccccccccccccccccccccccc'").get().state,'submitted');
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
 const f=fixture();try{await setup(f);f.env.AR3D_FUNDED_CUMULATIVE_SECONDS='0';
 const result=await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:()=>assert.fail('must not dial')});
 assert.equal(result.state,'provider_funding_exhausted');assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs').get().state,'queued');
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,0);
 delete f.env.AR3D_FUNDED_CUMULATIVE_SECONDS;
 assert.equal((await scriptedCampaignConfiguration(f.env)).ready,false);
 }finally{f.close()}
});

test('campaign start checks credits before creating a new run',async()=>{
 const f=fixture();try{await setup(f);
  const before=f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_runs').get().n;
  f.env.AR3D_FUNDED_CUMULATIVE_SECONDS='0';
  const state=await (await route(f,'state',{tenantId:tid},client,'GET')).json();
  assert.equal(state.credits.ready,false);assert.equal(state.credits.requiredSeconds,30);assert.equal(state.credits.reason,'funding_review_required');
  assert.equal(Object.hasOwn(state.credits,'capSeconds'),false);
  assert.equal((await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'})).status,409);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_runs').get().n,before);
  assert.equal((await route(f,'runs',{tenantId:tid,campaignId:cid,action:'pause'})).status,200);
 }finally{f.close()}
});
test('explicitly approved credit-only mode bypasses business daily cap, not funded capacity or consent',async()=>{
 const f=fixture();try{await setup(f);f.r.db.exec('UPDATE calling_policies SET daily_limit=1');
  await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('',{status:400})});
  const second='44444444-4444-4444-8444-444444444444',job='b'.repeat(32);
  f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Second fictional','+919000000002','excel',?,?)").run(tid,second,at,at);
  f.r.db.prepare("INSERT INTO calling_clearances SELECT tenant_id,?,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at FROM calling_clearances WHERE lead_id=?").run(second,lead);
  const run=f.r.db.prepare('SELECT id FROM calling_runs').get();
  f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,flow_id,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?,?)").run(tid,job,run.id,second,SCRIPTED_CALLING_POLICY,at,at);
  f.env.AR3D_CREDIT_ONLY_CALLING='approved';
  assert.equal((await scriptedCampaignConfiguration(f.env)).creditOnly,true);
  let posted=0;const result=await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async()=>{posted++;return accepted()}});
  assert.equal(result.state,'submitted');assert.equal(posted,1);
 }finally{f.close()}
});

test('partial review is tenant scoped, fills blanks only, rejects stale profile and is idempotent',async()=>{
 const f=fixture();try{await setup(f);
  const job=f.r.db.prepare('SELECT id FROM calling_jobs').get().id;
  f.r.db.prepare("UPDATE calling_jobs SET state='failed' WHERE id=?").run(job);
  f.r.db.prepare("UPDATE leads SET preferred_location='Existing city',budget_max_inr=9000000 WHERE id=?").run(lead);
  const snapshot={__partial:true,propertyType:'house',location:'कोरबा',area:'बस स्टैंड',size:'3BHK',budgetMinInr:2000000,budgetInr:3000000};
  f.r.db.prepare("INSERT INTO scripted_call_results VALUES(?,?, 'partial-synthetic',?,0,?)").run(tid,job,JSON.stringify(snapshot),at);
  const request={tenantId:tid,jobId:job,expectedUpdatedAt:at};
  assert.equal((await route(f,'review-partial',request,{id:'viewer',globalRole:'user'})).status,403);
  assert.equal((await route(f,'review-partial',{...request,expectedUpdatedAt:'2020-01-01T00:00:00Z'})).status,409);
  const response=await route(f,'review-partial',request);assert.equal(response.status,200,await response.clone().text());
  const row=f.r.db.prepare("SELECT * FROM leads WHERE id=?").get(lead);
  assert.equal(row.preferred_location,'Existing city');assert.equal(row.plot_size_preference,'3BHK');assert.equal(row.budget_max_inr,9000000);assert.equal(row.budget_min_inr,null);
  assert.equal(JSON.parse(row.requirements_json).reviewedPartialCall.answers.area,'बस स्टैंड');
  assert.equal(row.consent_status,'unknown');assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM site_visits').get().n,0);
  assert.equal((await (await route(f,'review-partial',request)).json()).replayed,true);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='calling.partial_reviewed'").get().n,1);
  assert.equal(JSON.parse(f.r.db.prepare('SELECT answers_json FROM scripted_call_results WHERE job_id=?').get(job).answers_json).__partial,true);
  const results=await (await route(f,'results',{tenantId:tid},client,'GET')).json();assert.equal(results.results[0].partialReviewed,true);
 }finally{f.close()}
});

test('last 30 to 150 seconds of client or provider capacity set the exact Plivo hard limit',async()=>{
 for(const [clientSeconds,providerSeconds,expected] of [[30,600,30],[90,600,90],[150,60,60],[150,29,0],[29,600,0]]){
  const f=fixture();try{
   await setup(f);
   f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('tail',?,'recovery',?,6000,?,'admin','Synthetic tail balance',?)").run(tid,clientSeconds-6000,clientSeconds,at);
   f.env.AR3D_SARVAM_FUNDED_CUMULATIVE_SECONDS=String(providerSeconds);
   let posted=0;
   const out=await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async(_url,options)=>{
    posted++;const body=JSON.parse(options.body);
    assert.equal(body.time_limit,expected);
    assert.equal(f.c.db.prepare('SELECT reserved_seconds FROM tenant_minute_holds').get().reserved_seconds,expected);
    return accepted();
   }});
   assert.equal(posted,expected?1:0);
   assert.equal(out.state,expected?'submitted':clientSeconds<30?'insufficient_credits':'provider_funding_exhausted');
  }finally{f.close()}
 }
});
test('missing independent provider funding cannot start or submit a commercial call',async()=>{
 for(const key of ['AR3D_PLIVO_FUNDED_CUMULATIVE_SECONDS','AR3D_SARVAM_FUNDED_CUMULATIVE_SECONDS']){
  const f=fixture();try{await setup(f);delete f.env[key];
   assert.equal((await scriptedCampaignConfiguration(f.env)).ready,false);
   assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:()=>assert.fail('must not dial')})).state,'funding_approval_required');
   assert.equal((await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'})).status,503);
  }finally{f.close()}
 }
});

test('provider fault interlock stops new dispatch, preserves credits, and needs explicit review',async()=>{
 const f=fixture();try{await setup(f);
 const {recordProviderFault,reviewProviderFault,providerSafety}=await import('../src/provider-safety.mjs');
 await recordProviderFault(f.env.CONTROL_DB,'sarvam',402,'test-stt-402',now);
 assert.equal((await scriptedCampaignConfiguration(f.env)).ready,false);
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:()=>assert.fail('must not dial')})).state,'provider_review_required');
 const sarvam=(await providerSafety(f.env.CONTROL_DB)).find(x=>x.provider==='sarvam');
 assert.equal(await reviewProviderFault(f.env.CONTROL_DB,{provider:'sarvam',expectedSequence:sarvam.sequence+1,evidenceRef:'Receipt verified 123',actor:'admin',now}),false);
 assert.equal(await reviewProviderFault(f.env.CONTROL_DB,{provider:'sarvam',expectedSequence:sarvam.sequence,evidenceRef:'Receipt verified 123',actor:'admin',now}),true);
 assert.equal((await scriptedCampaignConfiguration(f.env)).ready,true);
 assert.equal(await recordProviderFault(f.env.CONTROL_DB,'sarvam',429,'test-rate-limit',now),false);
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('payment required',{status:402})})).state,'unknown');
 assert.equal((await providerSafety(f.env.CONTROL_DB)).find(x=>x.provider==='plivo').blocked,true);
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:()=>assert.fail('must not redial')})).state,'waiting_or_locked');
 assert.equal(f.c.db.prepare("SELECT state FROM tenant_minute_holds").get().state,'held');
 assert.throws(()=>f.c.db.exec('DELETE FROM provider_safety_events'),/immutable/);
 }finally{f.close()}
});

test('final eligibility fence cancels before Plivo POST after reservation, releasing only unused hold',async()=>{
 for(const change of ['optout','pause','suspend','clearance','policy']){
  const f=fixture();try{
   await setup(f);
   const db=f.c.wrap;
   let inserted=false,posts=0;
   f.env.CONTROL_DB={...db,prepare(sql){
    const st=db.prepare(sql);
    if(!sql.includes('INSERT INTO scripted_phone_pilots'))return st;
    return {...st,bind(...args){
     const bound=st.bind(...args);
     return {...bound,async run(){
      const result=await bound.run();
      if(result.meta.changes===1&&!inserted){
       inserted=true;
       if(change==='optout')f.r.db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id=? AND id=?").run(tid,lead);
       if(change==='pause')f.r.db.prepare("UPDATE calling_runs SET state='paused' WHERE tenant_id=?").run(tid);
       if(change==='suspend')f.c.db.prepare("UPDATE tenants SET status='suspended',suspended_from_status='active' WHERE id=?").run(tid);
       if(change==='clearance')f.r.db.prepare("DELETE FROM calling_clearances WHERE tenant_id=? AND lead_id=?").run(tid,lead);
       if(change==='policy')f.r.db.prepare("UPDATE calling_policies SET enabled=0 WHERE tenant_id=?").run(tid);
      }
      return result;
     }};
    }};
   }};
   const outcome=await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>{posts++;return accepted()}});
   assert.equal(inserted,true,change);assert.equal(posts,0,change);assert.equal(outcome.state,'failed',change);
   const job=f.r.db.prepare('SELECT state,error_code FROM calling_jobs').get();
   assert.equal(job.state,'failed');assert.equal(job.error_code,'eligibility_changed_before_submission');
   const hold=f.c.db.prepare('SELECT state,charged_seconds,evidence_ref FROM tenant_minute_holds').get();
   assert.equal(hold.state,'released');assert.equal(hold.charged_seconds,0);assert.match(hold.evidence_ref,/^pre-submit-blocked:/);
   const row=f.c.db.prepare('SELECT phase,provider_request_id,provider_call_id FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get();
   assert.equal(row.phase,'rejected');assert.equal(row.provider_request_id,null);assert.equal(row.provider_call_id,null);
  }finally{f.close()}
 }
});
