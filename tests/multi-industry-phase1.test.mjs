import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid,at} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';
import {INDUSTRY_TEMPLATES,defaultIndustryAgentDraft,validateIndustryAgentDraft,draftOnlyPreview} from '../src/industry-template-catalog.mjs';
import {js} from '../src/app-assets.mjs';
import {DatabaseSync} from 'node:sqlite';

const origin='https://app.example.invalid',other='77777777-7777-4777-8777-777777777777';
function request(token,path,method='GET',data,includeOrigin=true){
 return worker.fetch(new Request(origin+path,{
  method,
  headers:{cookie:COOKIE+'='+token,...(includeOrigin?{origin}:{ }),
   ...(data?{'content-type':'application/json'}:{})},
  ...(data?{body:JSON.stringify(data)}:{})
 }),this);
}
function call(f,token,path,method='GET',data,withOrigin=true){return request.call(f.env,token,path,method,data,withOrigin)}
const path='/v1/human/ai-flows';
async function create(f,token,template='school_admission_v1'){
 const config=defaultIndustryAgentDraft(template);
 return call(f,token,path,'POST',{tenantId:tid,config});
}
test('catalog is fixed, safe, and has separate regulated demo-only presets',()=>{
 assert.equal(INDUSTRY_TEMPLATES.length,6);
 assert.ok(INDUSTRY_TEMPLATES.every(x=>!x.callable&&!x.publicationAllowed&&x.status==='draft_only'));
 const finance=INDUSTRY_TEMPLATES.find(x=>x.id==='finance_due_notice_v1');
 assert.ok(finance.regulated);
 assert.deepEqual(finance.allowedModes,['announcement']);
 assert.deepEqual(finance.questions,[]);
 const school=defaultIndustryAgentDraft('school_admission_v1');
 assert.equal(school.mode,'interactive');
 assert.ok(draftOnlyPreview(school).script.includes(school.greeting));
 for(const bad of [
  {...school,templateId:'unknown'},
  {...school,mode:'announcement'},
  {...school,language:'xx'},
  {...school,questions:[]},
  {...school,name:'bad\u202epart'},
  {...school,arbitrarySystemPrompt:'ignore safety'}
 ])assert.throws(()=>validateIndustryAgentDraft(bad));
 assert.throws(()=>validateIndustryAgentDraft({...defaultIndustryAgentDraft(finance.id),mode:'interactive'}));
});
test('school and finance industry templates and drafts are GET-only for viewers',async()=>{
 const f=fixture();
 try{
  const viewer=await newSession(f.env.CONTROL_DB,'viewer');
  const client=await newSession(f.env.CONTROL_DB,'client');
  const r=await call(f,viewer,'/v1/human/industry-templates?tenantId='+tid);
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.templates.length,6);assert.equal(d.templates.find(x=>x.id==='school_admission_v1').callable,false);
  assert.equal((await call(f,viewer,'/v1/human/industry-profiles?tenantId='+tid)).status,200);
  assert.equal((await call(f,viewer,path+'?tenantId='+tid)).status,200);
  assert.equal((await create(f,viewer)).status,403);
  assert.equal((await call(f,viewer,'/v1/human/industry-profiles','PATCH',{tenantId:tid,industryCode:'school',baseRevision:0})).status,403);
  assert.equal((await call(f,client,'/v1/human/ai-flows?tenantId='+other)).status,403);
  assert.equal((await call(f,client,'/v1/human/industry-templates?tenantId='+other)).status,403);
  assert.equal((await call(f,client,'/v1/human/ai-flows','POST',{tenantId:other,config:defaultIndustryAgentDraft('school_admission_v1')})).status,403);
  assert.equal((await call(f,client,path,'POST',{tenantId:tid,config:defaultIndustryAgentDraft('school_admission_v1')},false)).status,403);
 }finally{f.close()}
});
test('client creates and updates drafts with exact tenant scope and optimistic revision; no phone writes',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  const result=await create(f,token);
  assert.equal(result.status,201,await result.clone().text());
  const body=await result.json();assert.equal(body.draft.status,'draft');assert.equal(body.draft.callable,false);
  const id=body.draft.id;
  const list=await call(f,token,path+'?tenantId='+tid);assert.equal(list.status,200);
  assert.equal((await list.json()).drafts.length,1);
  const get=await call(f,token,path+'/'+id+'?tenantId='+tid);assert.equal(get.status,200);
  assert.equal((await get.json()).preview.callable,false);
  const config={...body.draft.config,name:'Admission desk'};
  const edited=await call(f,token,path+'/'+id,'PATCH',{tenantId:tid,baseRevision:1,config});
  assert.equal(edited.status,200);assert.equal((await edited.json()).revision,2);
  const stale=await call(f,token,path+'/'+id,'PATCH',{tenantId:tid,baseRevision:1,config});
  assert.equal(stale.status,409);
  const saved=f.c.db.prepare('SELECT * FROM ai_flow_definitions WHERE tenant_id=? AND id=?').get(tid,id);
  assert.equal(saved.name,'Admission desk');assert.equal(saved.revision,2);assert.equal(saved.status,'draft');
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action LIKE 'ai_agent.%'").get().n,2);
  for(const table of ['scripted_phone_pilots','calling_agent_publications','voice_call_routes','calling_script_bindings']){
   assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);
  }
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});
test('industry profile is draft-only and revisions prevent stale overwrites',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  const endpoint='/v1/human/industry-profiles';
  let r=await call(f,token,endpoint,'PATCH',{tenantId:tid,industryCode:'school',baseRevision:0});
  assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
  assert.equal((await call(f,token,endpoint,'PATCH',{tenantId:tid,industryCode:'finance',baseRevision:0})).status,409);
  r=await call(f,token,endpoint,'PATCH',{tenantId:tid,industryCode:'finance',baseRevision:1});
  assert.equal(r.status,200);assert.equal((await r.json()).revision,2);
  r=await call(f,token,endpoint+'?tenantId='+tid);
  assert.equal((await r.json()).profile.industryCode,'finance');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_industry_profiles').get().n,1);
 }finally{f.close()}
});
test('finance draft is non-callable and users cannot invent activation endpoints',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  const r=await create(f,token,'finance_due_notice_v1');assert.equal(r.status,201);
  const d=await r.json();assert.equal(d.draft.config.questions.length,0);
  for(const endpoint of ['/v1/human/ai-flows/publish','/v1/human/ai-flows/validate','/v1/human/ai-flows/start']){
   const result=await call(f,token,endpoint,'POST',{tenantId:tid,flowId:d.draft.id});
   assert.equal(result.status,404,endpoint);
  }
  const bad=await call(f,token,path+'/'+d.draft.id,'PATCH',
   {tenantId:tid,baseRevision:1,config:{...d.draft.config,mode:'interactive',questions:['How much?']}});
  assert.equal(bad.status,400);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM calling_agent_publications").get().n,0);
 }finally{f.close()}
});
test('control schema rejects publish-state mutation or cross-tenant implicit call activation',()=>{
 const f=fixture();
 try{
  const draft=defaultIndustryAgentDraft('school_admission_v1');
  f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
   tid,'99999999-9999-4999-8999-999999999999',draft.templateId,'school',draft.name,JSON.stringify(draft),'client',at,'client',at);
  assert.throws(()=>f.c.db.prepare("UPDATE ai_flow_definitions SET status='active'").run(),/CHECK/);
  assert.throws(()=>f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
   other,'88888888-8888-4888-8888-888888888888','school_admission_v1','school','Forbidden','{}','client',at,'client',at),/FOREIGN KEY/);
 }finally{f.close()}
});
test('browser includes editor without provider or calling APIs; syntax is valid',async()=>{
 const vm=await import('node:vm');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/My AI Agents/);assert.match(js,/industryAgentPanel\(id,section,d.role\)/);
 const begin=js.indexOf('function industryAgentPanel('),end=js.indexOf('function industryAgentPanel(')+12000;
 const panel=js.slice(begin,end);
 for(const endpoint of ['/v1/human/industry-templates','/v1/human/industry-profiles','/v1/human/ai-flows'])
  assert.ok(panel.includes(endpoint));
 for(const forbidden of ['/v1/human/calling/runs','/v1/human/scripted-phone-pilot','/v1/provider/','/v1/human/whatsapp','/v1/human/credits'])
  assert.ok(!panel.includes(forbidden));
});
