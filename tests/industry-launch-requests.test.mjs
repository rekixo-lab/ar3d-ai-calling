import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {sha256hex} from '../src/core.mjs';
import {handleIndustryLaunchRequests} from '../src/industry-launch-requests.mjs';
const flow='abababab-abab-4bab-8bab-abababababab',version='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const base='https://app.example.invalid/v1/human/industry-launch-requests';
async function seed(f,template='school_admission_v1'){
 const c=defaultIndustryAgentDraft(template),g=compileDraftToFlow(c),config=JSON.stringify(c),graph=JSON.stringify(g);
 f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,'client',?,'client',?)").run(tid,flow,c.templateId,g.industry,c.name,config,at,at);
 f.c.db.prepare("INSERT INTO ai_flow_snapshots(tenant_id,id,flow_id,source_revision,template_id,config_json,graph_json,graph_sha256,compiler_version,status,created_by,created_at) VALUES(?,?,?,1,?,?,?,?,1,'simulation_only','client',?)").run(tid,version,flow,c.templateId,config,graph,await sha256hex('ar3d:offline-flow:v1:'+graph),at);
}
const call=(f,data,user=client,suffix='',method='POST')=>handleIndustryLaunchRequests(new Request(base+suffix+(method==='GET'?'?'+new URLSearchParams(data):''),{method,headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},...(method==='POST'?{body:JSON.stringify(data)}:{})}),f.env,user,{now});
const input={tenantId:tid,snapshotId:version,acknowledgeProductionReview:true};
test('production configuration review is version bound, independent and never callable',async()=>{
 const f=fixture();
 try{
  await seed(f);
  assert.equal((await call(f,input,{id:'viewer',globalRole:'user'})).status,403);
  const requested=await call(f,input);
  assert.equal(requested.status,201);const r=await requested.json();
  assert.equal(r.callable,false);assert.equal(r.dispatchReady,false);
  assert.equal((await call(f,input)).status,409);
  assert.equal((await call(f,{tenantId:tid}, {...admin,token_hash:'bad'},'', 'GET')).status,403);
  const list=await (await call(f,{tenantId:tid},admin,'','GET')).json();
  assert.equal(list.requests.length,1);assert.equal(list.requests[0].config.templateId,'school_admission_v1');
  const review={tenantId:tid,decision:'configuration_reviewed',reference:'Reviewed exact School script',acknowledgeNoCalling:true};
  assert.equal((await call(f,review,client,'/'+r.requestId+'/review')).status,403);
  const reviewed=await call(f,review,admin,'/'+r.requestId+'/review');assert.equal(reviewed.status,200);
  assert.equal((await reviewed.json()).dispatchReady,false);
  assert.equal((await call(f,review,admin,'/'+r.requestId+'/review')).status,409);
  assert.throws(()=>f.c.db.prepare("UPDATE industry_launch_requests SET graph_sha256=?").run('0'.repeat(64)),/immutable industry launch request/);
  assert.throws(()=>f.c.db.prepare("DELETE FROM industry_launch_requests").run(),/immutable industry launch request/);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs").get().n,0);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM scripted_phone_pilots").get().n,0);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_minute_holds").get().n,0);
 }finally{f.close()}
});
test('stale snapshots, other industries and cross-tenant requests fail closed',async()=>{
 const f=fixture();
 try{
  await seed(f);
  assert.equal((await call(f,{...input,tenantId:'77777777-7777-4777-8777-777777777777'})).status,403);
  f.c.db.prepare('UPDATE ai_flow_definitions SET revision=2').run();
  assert.equal((await call(f,input)).status,409);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM industry_launch_requests').get().n,0);
 }finally{f.close()}
 const finance=fixture();
 try{await seed(finance,'finance_due_notice_v1');assert.equal((await call(finance,input)).status,409)}finally{finance.close()}
});
