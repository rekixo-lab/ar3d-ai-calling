import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,admin,client,now,until,route,configureScriptedCampaign,accepted,at} from './helpers/calling-fixture.mjs';
import {approvedCampaignPhone} from '../src/scripted-phone-pilot.mjs';
import {tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';

// Client-declared consent: AR3D approves the company once; the Client Admin
// declares the consent source when starting. No per-customer Super Admin step.
test('client-declared consent clears campaign customers at Start, never opted-out ones',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  // A second customer in the same campaign who already said "stop".
  const stopped='55555555-5555-4555-8555-555555555555';
  f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Stopped buyer','+919000000002','excel',?,?)").run(tid,stopped,at,at);
  f.r.db.prepare('INSERT INTO call_campaign_candidates VALUES(?,?,?,?)').run(tid,cid,stopped,at);
  f.r.db.prepare("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at) VALUES(?,?,?,'customer_request','system',?)").run(tid,crypto.randomUUID(),stopped,at);
  // Client cannot set its own consent mode; only a current-MFA Super Admin can.
  assert.equal((await route(f,'policy',{tenantId:tid,enabled:true,approvalReference:'provider-approval-ref',expiresAt:until,maxSeconds:180,consentMode:'client_declared'},client)).status,403);
  const yearly=new Date(now+360*86400000).toISOString();
  const saved=await route(f,'policy',{tenantId:tid,enabled:true,approvalReference:'provider-approval-ref',expiresAt:yearly,maxSeconds:180,consentMode:'client_declared'},admin);
  assert.equal(saved.status,200,await saved.text());
  assert.equal((await (await route(f,'policy',{tenantId:tid},admin,'GET')).json()).consentMode,'client_declared');
  assert.equal((await (await route(f,'state',{tenantId:tid},client,'GET')).json()).consentMode,'client_declared');
  // Start without a declaration is refused; a bad declaration too.
  let r=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'});
  assert.equal(r.status,409);assert.equal((await r.json()).error,'consent_declaration_required');
  r=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start',consent:{source:'made_up',confirmed:true}});
  assert.equal(r.status,400);
  r=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start',consent:{source:'website_enquiry',confirmed:false}});
  assert.equal(r.status,400);
  r=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start',consent:{source:'website_enquiry',confirmed:true}});
  assert.equal(r.status,202,await r.text());
  const cleared=f.r.db.prepare('SELECT lead_id,consent_reference,reviewed_by,expires_at FROM calling_clearances WHERE tenant_id=?').all(tid);
  assert.deepEqual(cleared.map(x=>x.lead_id),[lead]);
  assert.match(cleared[0].consent_reference,/^client-declared:website_enquiry:/);
  assert.equal(cleared[0].reviewed_by,'client:client');
  assert.equal(cleared[0].expires_at,yearly);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='calling.consent_declared'").get().n,1);
  // The declared customer is dialed; the stopped customer never is.
  const config=await approvedCampaignPhone(f.env);let to=null;
  const tick=await tickScriptedTenant(f.env,f.r.wrap,tid,config,{now:now+1000,apiFetch:async(_u,opts)=>{to=JSON.parse(opts.body).to;return accepted()}});
  assert.equal(tick.state,'submitted');assert.equal(to,'+919000000001');
  assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs WHERE lead_id=?').get(stopped)?.state??'blocked','blocked');
 }finally{f.close()}
});

test('reviewed mode keeps per-customer Super Admin clearance; declaration is ignored',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  assert.equal((await route(f,'policy',{tenantId:tid,enabled:true,approvalReference:'provider-approval-ref',expiresAt:until,dailyLimit:10,maxSeconds:180},admin)).status,200);
  assert.equal((await (await route(f,'policy',{tenantId:tid},admin,'GET')).json()).consentMode,'reviewed');
  const r=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start',consent:{source:'referral',confirmed:true}});
  assert.equal(r.status,202,await r.text());
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_clearances').get().n,0);
  const config=await approvedCampaignPhone(f.env);
  assert.equal((await tickScriptedTenant(f.env,f.r.wrap,tid,config,{now:now+1000,apiFetch:()=>assert.fail('needs clearance')})).state,'idle_or_clearance_required');
 }finally{f.close()}
});

test('platform capacity is Super Admin only, bounded, and returned with live calls',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  assert.equal((await route(f,'capacity',{},client,'GET')).status,403);
  assert.equal((await route(f,'capacity',{maxConcurrent:50,maxPerCompany:5},client)).status,403);
  let d=await (await route(f,'capacity',{},admin,'GET')).json();
  assert.equal(d.maxConcurrent,8);assert.equal(d.saved,false);assert.equal(d.liveCalls,0);
  assert.equal((await route(f,'capacity',{maxConcurrent:0,maxPerCompany:5},admin)).status,400);
  assert.equal((await route(f,'capacity',{maxConcurrent:3000,maxPerCompany:5},admin)).status,400);
  assert.equal((await route(f,'capacity',{maxConcurrent:50,maxPerCompany:5,extra:1},admin)).status,400);
  d=await (await route(f,'capacity',{maxConcurrent:300,maxPerCompany:20},admin)).json();
  assert.deepEqual([d.maxConcurrent,d.maxPerCompany,d.saved],[300,20,true]);
  // Per-company limit can never exceed the platform limit.
  d=await (await route(f,'capacity',{maxConcurrent:10,maxPerCompany:40},admin)).json();
  assert.equal(d.maxPerCompany,10);
 }finally{f.close()}
});
