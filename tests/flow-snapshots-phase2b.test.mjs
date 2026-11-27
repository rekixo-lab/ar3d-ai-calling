import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid,admin} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {validateFlowGraph} from '../src/call-flow-dsl.mjs';

const origin='https://app.example.invalid',other='77777777-7777-4777-8777-777777777777';
const endpoint='/v1/human/ai-flow-snapshots';
const query=(path,tenantId=tid)=>path+'?tenantId='+encodeURIComponent(tenantId);
const call=(f,token,path,method='GET',data,validOrigin=true)=>worker.fetch(new Request(origin+path,{
 method,headers:{cookie:COOKIE+'='+token,...(validOrigin?{origin}:{}),
  ...(data?{'content-type':'application/json'}:{})},
 ...(data?{body:JSON.stringify(data)}:{})
}),f.env);
async function setup(f,tpl='school_admission_v1'){
 const token=await newSession(f.env.CONTROL_DB,'client'),config=defaultIndustryAgentDraft(tpl);
 const create=await call(f,token,'/v1/human/ai-flows','POST',{tenantId:tid,config});
 assert.equal(create.status,201,await create.clone().text());
 return {token,config,flowId:(await create.json()).draft.id};
}
async function freeze(f,s){
 const r=await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:1});
 assert.equal(r.status,201,await r.clone().text());
 return (await r.json()).snapshot;
}
test('freeze exact saved revision; revision conflicts and duplicates are safe and audited once',async()=>{
 const f=fixture();
 try{
  const s=await setup(f),first=await freeze(f,s);
  assert.equal(first.status,'simulation_only');assert.equal(first.callable,false);
  assert.equal(first.liveApproved,false);assert.equal(first.review,'awaiting_review');
  assert.equal(first.digest.length,64);
  const stale=await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:0});
  assert.equal(stale.status,400);
  const duplicate=await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:1});
  assert.equal(duplicate.status,409);
  let versions=await call(f,s.token,query(endpoint)+'&flowId='+s.flowId);
  assert.equal(versions.status,200);assert.equal((await versions.json()).snapshots.length,1);
  const bad=await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:99});
  assert.equal(bad.status,409);
  const changed={...s.config,greeting:'Fictional school revised greeting'};
  const edit=await call(f,s.token,'/v1/human/ai-flows/'+s.flowId,'PATCH',
   {tenantId:tid,baseRevision:1,config:changed});
  assert.equal(edit.status,200);
  const second=await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:2});
  assert.equal(second.status,201);
  const details=await call(f,s.token,query(endpoint+'/'+first.id));
  assert.equal(details.status,200);
  const graph=(await details.json()).graph;
  assert.equal(graph.nodes[0].text,s.config.greeting,'first snapshot is unchanged by later draft edits');
  assert.equal(validateFlowGraph(graph),graph);
  const count=f.c.db.prepare("SELECT COUNT(*) AS n FROM ai_flow_snapshots WHERE tenant_id=?").get(tid).n;
  assert.equal(count,2);
  const audits=f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='ai_flow.simulation_snapshot_created'").get().n;
  assert.equal(audits,2);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
 }finally{f.close()}
});
test('immutable storage rejects UPDATE/DELETE for snapshots and MFA review history',async()=>{
 const f=fixture();
 try{
  const s=await setup(f),v=await freeze(f,s);
  assert.throws(()=>f.c.db.prepare("UPDATE ai_flow_snapshots SET status='ready' WHERE id=?").run(v.id),/immutable|CHECK/);
  assert.throws(()=>f.c.db.prepare("UPDATE ai_flow_snapshots SET graph_json='{}' WHERE id=?").run(v.id),/immutable/);
  assert.throws(()=>f.c.db.prepare("DELETE FROM ai_flow_snapshots WHERE id=?").run(v.id),/cannot be deleted/);
  const adminToken=await newSession(f.env.CONTROL_DB,'admin');
  const review=await call(f,adminToken,endpoint+'/'+v.id+'/review','POST',
   {tenantId:tid,decision:'simulation_reviewed',reason:'Verified for fictional rehearsal only.',acknowledgeSimulationOnly:true});
  assert.equal(review.status,200,await review.clone().text());
  const result=await review.json();assert.equal(result.liveApproved,false);
  assert.throws(()=>f.c.db.prepare("UPDATE ai_flow_preview_reviews SET decision='simulation_rejected' WHERE snapshot_id=?").run(v.id),/immutable/);
  assert.throws(()=>f.c.db.prepare('DELETE FROM ai_flow_preview_reviews WHERE snapshot_id=?').run(v.id),/cannot be deleted/);
  const again=await call(f,adminToken,endpoint+'/'+v.id+'/review','POST',
   {tenantId:tid,decision:'simulation_rejected',reason:'Change of mind',acknowledgeSimulationOnly:true});
  assert.equal(again.status,409);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='ai_flow.simulation_review_recorded'").get().n,1);
 }finally{f.close()}
});
test('viewer and cross-tenant users cannot freeze, simulate or review snapshots',async()=>{
 const f=fixture();
 try{
  const s=await setup(f),v=await freeze(f,s),viewer=await newSession(f.env.CONTROL_DB,'viewer');
  assert.equal((await call(f,viewer,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:1})).status,403);
  assert.equal((await call(f,viewer,endpoint+'/'+v.id+'/simulate','POST',{tenantId:tid,answers:['yes']})).status,403);
  assert.equal((await call(f,s.token,endpoint+'/'+v.id+'/review','POST',
   {tenantId:tid,decision:'simulation_reviewed',reason:'No authority',acknowledgeSimulationOnly:true})).status,403);
  assert.equal((await call(f,s.token,endpoint,'POST',{tenantId:other,flowId:s.flowId,baseRevision:1})).status,403);
  assert.equal((await call(f,s.token,query(endpoint+'/'+v.id,other))).status,403);
  assert.equal((await call(f,s.token,endpoint+'/'+v.id+'/simulate','POST',{tenantId:other,answers:['yes']})).status,403);
  assert.equal((await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:1},false)).status,403);
  assert.equal((await call(f,s.token,endpoint,'POST',{tenantId:tid,flowId:s.flowId,baseRevision:1,live:true})).status,400);
  assert.equal((await call(f,s.token,endpoint+'/'+v.id,'PATCH',{tenantId:tid})).status,405);
  assert.equal((await call(f,s.token,'/v1/human/ai-flow-snapshots/publish','POST',{tenantId:tid})).status,404);
 }finally{f.close()}
});
test('only current MFA-backed Super Admin can review, and review is never calling approval',async()=>{
 const f=fixture();
 try{
  const s=await setup(f,'finance_due_notice_v1'),v=await freeze(f,s);
  const adminToken=await newSession(f.env.CONTROL_DB,'admin');
  const request=(decision,reason,ack=true)=>call(f,adminToken,endpoint+'/'+v.id+'/review','POST',
   {tenantId:tid,decision,reason,acknowledgeSimulationOnly:ack});
  assert.equal((await request('go_live','Not an allowed action')).status,400);
  assert.equal((await request('simulation_reviewed','Okay',false)).status,400);
  assert.equal((await request('simulation_reviewed','X')).status,400);
  const r=await request('simulation_rejected','Needs stronger institution approval.');
  assert.equal(r.status,200,await r.clone().text());
  const listing=await call(f,s.token,query(endpoint)+'&flowId='+s.flowId);
  assert.equal((await listing.json()).snapshots[0].review,'simulation_rejected');
  assert.equal(f.c.db.prepare("SELECT status FROM ai_flow_snapshots WHERE id=?").get(v.id).status,'simulation_only');
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM voice_call_routes").get().n,0);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM calling_agent_publications").get().n,0);
  const newest=await newSession(f.env.CONTROL_DB,'admin');
  f.c.db.prepare('UPDATE human_mfa_settings SET enabled_at=? WHERE user_id=?')
   .run(new Date(Date.now()+10000).toISOString(),'admin');
  const denied=await call(f,newest,query(endpoint+'/'+v.id));
  assert.equal(denied.status,403,'session older than newly enabled MFA must not pass');
  // Revoke only one security principal, without any customer calling activity.
 }finally{f.close()}
});
test('replaying frozen school questions uses the saved graph and no provider/CRM changes',async()=>{
 const f=fixture();
 try{
  const s=await setup(f),v=await freeze(f,s);
  const before=f.c.db.prepare('SELECT revision FROM ai_flow_definitions WHERE id=?').get(s.flowId).revision;
  const r=await call(f,s.token,endpoint+'/'+v.id+'/simulate','POST',
   {tenantId:tid,answers:['yes','Class 5','Please call us']});
  assert.equal(r.status,200,await r.clone().text());
  const data=await r.json();
  assert.equal(data.status,'simulated_complete');assert.equal(data.answersUsed,3);
  assert.equal(data.snapshot.id,v.id);assert.equal(data.providerRequests,0);
  assert.equal(data.crmMutations,0);assert.equal(data.whatsappMessages,0);
  assert.equal(f.c.db.prepare('SELECT revision FROM ai_flow_definitions WHERE id=?').get(s.flowId).revision,before);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,0);
 }finally{f.close()}
});
test('simulator snapshots contain no real finance due details and never fetch borrower identities',async()=>{
 const f=fixture();
 try{
  const s=await setup(f,'finance_due_notice_v1'),v=await freeze(f,s);
  const r=await call(f,s.token,endpoint+'/'+v.id+'/simulate','POST',{tenantId:tid,answers:[]});
  assert.equal(r.status,200);
  const result=await r.json();
  assert.equal(result.status,'simulated_complete');assert.equal(result.snapshot.liveApproved,false);
  assert.equal(JSON.stringify(result).includes('amount_due'),false);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM ai_flow_snapshots WHERE tenant_id=? AND template_id='finance_due_notice_v1'").get(tid).n,1);
 }finally{f.close()}
});
