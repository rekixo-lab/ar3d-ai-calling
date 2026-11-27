import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {sha256hex} from '../src/core.mjs';
import {handleIndustryLaunchRequests} from '../src/industry-launch-requests.mjs';
import {handleIndustryCampaigns,readIndustryRecipientScope} from '../src/industry-campaigns.mjs';
const version='abababab-abab-4bab-8bab-abababababab',flow='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const otherLead='45454545-4545-4545-8545-454545454545',missing='67676767-6767-4767-8767-676767676767';
const viewer={id:'viewer',globalRole:'user'};
const origin='https://app.example.invalid';
const base='/v1/human/industry-campaigns';
function req(path,data,method='POST',from=origin){
 return new Request(origin+path+(method==='GET'?'?'+new URLSearchParams(data):''),{method,
  headers:{'Content-Type':'application/json',Origin:from},...(method==='POST'?{body:JSON.stringify(data)}:{})});
}
async function launch(f,{review=true}={}){
 const c=defaultIndustryAgentDraft('school_admission_v1'),g=compileDraftToFlow(c),config=JSON.stringify(c),graph=JSON.stringify(g);
 f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,'client',?,'client',?)").run(tid,flow,c.templateId,g.industry,c.name,config,at,at);
 f.c.db.prepare("INSERT INTO ai_flow_snapshots(tenant_id,id,flow_id,source_revision,template_id,config_json,graph_json,graph_sha256,compiler_version,status,created_by,created_at) VALUES(?,?,?,1,?,?,?,?,1,'simulation_only','client',?)").run(tid,version,flow,c.templateId,config,graph,await sha256hex('ar3d:offline-flow:v1:'+graph),at);
 const result=await handleIndustryLaunchRequests(req('/v1/human/industry-launch-requests',{tenantId:tid,snapshotId:version,acknowledgeProductionReview:true}),f.env,client,{now});
 assert.equal(result.status,201);const {requestId}=await result.json();
 if(review)await approve(f,requestId);
 return requestId;
}
async function approve(f,id){
 const result=await handleIndustryLaunchRequests(req('/v1/human/industry-launch-requests/'+id+'/review',{tenantId:tid,decision:'configuration_reviewed',reference:'Reviewed exact School script',acknowledgeNoCalling:true}),f.env,admin,{now});
 assert.equal(result.status,200);
}
const route=(f,path='',data={tenantId:tid},user=client,method='POST',time=now,from=origin)=>handleIndustryCampaigns(req(base+path,data,method,from),f.env,user,{now:time});
const create=(f,id,user=client)=>route(f,'',{tenantId:tid,launchRequestId:id,name:'School enquiries'},user);
async function campaign(f){
 const id=await launch(f),res=await create(f,id);
 assert.equal(res.status,201);return (await res.json()).id;
}
async function recipients(f,id,user=admin,time=now){
 const res=await route(f,'/'+id+'/recipients',{tenantId:tid},user,'GET',time);
 assert.equal(res.status,200);return (await res.json()).recipients;
}
const clearance=(x,overrides={})=>({tenantId:tid,leadId:x.leadId,baseRevision:x.revision,decision:'cleared',
 consentReference:'guardian-consent-record',dndReference:'reviewed-dnd-record',expiresAt:new Date(now+3600000).toISOString(),
 reviewTarget:x.reviewTarget,acknowledgeGuardianAndPurpose:true,...overrides});
const review=(f,id,data,user=admin,time=now)=>route(f,'/'+id+'/review',data,user,'POST',time);
const scope=(f,id,leadId=lead,time=now)=>readIndustryRecipientScope(f.env,{tenantId:tid,campaignId:id,leadId,now:time});
function noCalls(f){
 for(const table of ['calling_jobs','scripted_call_results'])assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
 for(const table of ['scripted_phone_pilots','tenant_minute_holds','provider_cost_reservations'])assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
}
test('School campaign requires independently reviewed current frozen configuration and Client Admin membership',async()=>{
 const f=fixture();
 try{
  const request=await launch(f,{review:false});
  assert.equal((await create(f,request)).status,409);
  await approve(f,request);
  assert.equal((await create(f,request,viewer)).status,403);
  assert.equal((await create(f,request,admin)).status,403);
  assert.equal((await route(f,'',{tenantId:tid,launchRequestId:request,name:'wrong origin'},client,'POST',now,'https://other.invalid')).status,403);
  const res=await create(f,request);assert.equal(res.status,201);
  const {id,dispatchReady}=await res.json();assert.equal(dispatchReady,false);
  const row=f.r.db.prepare('SELECT * FROM industry_campaigns').get();assert.equal(row.purpose,'school_admission');assert.equal(row.snapshot_id,version);
  const list=await (await route(f,'',{tenantId:tid},viewer,'GET')).json();assert.equal(list.campaigns[0].id,id);assert.equal(list.campaigns[0].callable,false);
  assert.equal((await route(f,'',{tenantId:'77777777-7777-4777-8777-777777777777'},client,'GET')).status,403);
  f.c.db.prepare("UPDATE ai_flow_definitions SET revision=2").run();
  assert.equal((await create(f,request)).status,409);
  assert.throws(()=>f.r.db.prepare("UPDATE industry_campaigns SET graph_sha256=?").run('0'.repeat(64)),/immutable industry campaign/);
  assert.throws(()=>f.r.db.prepare('DELETE FROM industry_campaigns').run(),/immutable industry campaign/);
  noCalls(f);
 }finally{f.close()}
});
test('candidate batch is atomic, tenant-scoped, duplicate-safe and does not inherit property consent',async()=>{
 const f=fixture();
 try{
  const id=await campaign(f);
  f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Second guardian','+919000000002','excel',?,?)").run(tid,otherLead,at,at);
  const add=leadIds=>route(f,'/'+id+'/recipients',{tenantId:tid,leadIds});
  assert.equal((await add([lead,missing])).status,409);
  assert.equal((await recipients(f,id)).length,0);
  assert.equal((await add([lead,otherLead])).status,201);
  assert.equal((await add([lead])).status,409);
  const rows=await recipients(f,id);assert.equal(rows.length,2);
  assert.ok(rows.every(x=>x.status==='review_required'));
  assert.ok(rows.every(x=>/^[a-f0-9]{64}$/.test(x.reviewTarget)));
  const publicRows=await recipients(f,id,client);
  assert.ok(publicRows.every(x=>!Object.hasOwn(x,'reviewTarget')&&!Object.hasOwn(x,'consentReference')));
  assert.doesNotMatch(JSON.stringify(publicRows),/\+91900000000/);
  assert.equal((await route(f,'/'+id+'/available-leads',{tenantId:tid},viewer,'GET')).status,403);
  await assert.rejects(scope(f,id),/review_required/);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_clearances').get().n,0);
  noCalls(f);
 }finally{f.close()}
});
test('School recipient review binds exact current number and version, expires and can be revoked without granting legacy consent',async()=>{
 const f=fixture();
 try{
  const id=await campaign(f);
  assert.equal((await route(f,'/'+id+'/recipients',{tenantId:tid,leadIds:[lead]})).status,201);
  let x=(await recipients(f,id))[0],data=clearance(x);
  assert.equal((await review(f,id,data,client)).status,403);
  assert.equal((await review(f,id,data,{...admin,token_hash:'not-a-session'})).status,403);
  assert.equal((await review(f,id,{...data,acknowledgeGuardianAndPurpose:false})).status,400);
  assert.equal((await review(f,id,{...data,reviewTarget:'0'.repeat(64)})).status,409);
  // Same last four digits and same timestamp, different exact number.
  f.r.db.prepare("UPDATE leads SET mobile_e164='+918000000001' WHERE tenant_id=? AND id=?").run(tid,lead);
  assert.equal((await review(f,id,data)).status,409);
  x=(await recipients(f,id))[0];data=clearance(x);
  assert.equal((await review(f,id,data)).status,200);
  assert.equal((await review(f,id,data)).status,409);
  const scoped=await scope(f,id);assert.equal(scoped.destination,'+918000000001');assert.equal(scoped.snapshotId,version);assert.equal(scoped.reviewRevision,1);assert.equal(scoped.dispatchReady,false);
  const l=f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.equal(l.consent_status,'unknown');assert.equal(l.dnd_status,'unknown');
  await assert.rejects(scope(f,id,lead,now+3600000),/expired/);
  x=(await recipients(f,id))[0];assert.equal(x.status,'review_current');
  f.r.db.prepare('UPDATE leads SET updated_at=? WHERE tenant_id=? AND id=?').run(new Date(now+1000).toISOString(),tid,lead);
  await assert.rejects(scope(f,id),/recipient_changed/);
  x=(await recipients(f,id))[0];assert.equal(x.status,'recipient_changed');
  assert.equal((await review(f,id,clearance(x))).status,200);
  assert.equal((await review(f,id,{tenantId:tid,leadId:lead,baseRevision:2,decision:'revoked',reason:'Guardian withdrew permission'},client)).status,200);
  await assert.rejects(scope(f,id),/revoked/);
  assert.throws(()=>f.r.db.prepare("UPDATE industry_recipient_reviews SET decision='revoked'").run(),/immutable industry recipient review/);
  assert.throws(()=>f.r.db.prepare("DELETE FROM industry_recipient_reviews").run(),/immutable industry recipient review/);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM industry_recipient_reviews').get().n,3);
  noCalls(f);
 }finally{f.close()}
});
test('global opt-out suppresses industry reviews and archived campaigns cannot be changed',async()=>{
 const f=fixture();
 try{
  const id=await campaign(f);
  assert.equal((await route(f,'/'+id+'/recipients',{tenantId:tid,leadIds:[lead]})).status,201);
  const x=(await recipients(f,id))[0];
  assert.equal((await review(f,id,clearance(x))).status,200);
  f.r.db.prepare("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at) VALUES(?,'industry-opt-out',?,'customer_request','client',?)").run(tid,lead,at);
  await assert.rejects(scope(f,id),/suppressed_or_missing/);
  const current=(await recipients(f,id))[0];assert.equal(current.status,'suppressed_or_missing');
  assert.equal((await review(f,id,clearance(current))).status,409);
  assert.equal((await route(f,'/'+id+'/archive',{tenantId:tid,confirm:true},viewer)).status,403);
  assert.equal((await route(f,'/'+id+'/archive',{tenantId:tid,confirm:true})).status,200);
  await assert.rejects(scope(f,id),/campaign_unavailable/);
  assert.equal((await review(f,id,clearance(current))).status,409);
  assert.equal((await route(f,'/'+id+'/recipients',{tenantId:tid,leadIds:[otherLead]})).status,409);
  noCalls(f);
 }finally{f.close()}
});
