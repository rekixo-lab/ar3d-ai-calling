// MI-02: offline flow compiler/simulator and tenant isolation regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';
import {INDUSTRY_TEMPLATES,defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {compileDraftToFlow,validateFlowGraph,simulateFlowGraph,FLOW_DSL_VERSION} from '../src/call-flow-dsl.mjs';
import {js} from '../src/app-assets.mjs';

const origin='https://app.example.invalid',foreign='77777777-7777-4777-8777-777777777777';
function call(f,token,path,method='GET',data,originAllowed=true){
 return worker.fetch(new Request(origin+path,{
  method,headers:{cookie:COOKIE+'='+token,
   ...(originAllowed?{origin}:{}),
   ...(data?{'content-type':'application/json'}:{})},
  ...(data?{body:JSON.stringify(data)}:{})
 }),f.env);
}
const duplicate=thing=>JSON.parse(JSON.stringify(thing));
const storedDraft=(f,config)=>{
 const id=crypto.randomUUID(),at=new Date().toISOString();
 const industry=INDUSTRY_TEMPLATES.find(x=>x.id===config.templateId).industry;
 f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
  .run(tid,id,config.templateId,industry,config.name,JSON.stringify(config),'client',at,'client',at);
 return id;
};
test('every industry draft compiles to a bounded deterministic, non-callable DAG',()=>{
 for(const t of INDUSTRY_TEMPLATES){
  const c=defaultIndustryAgentDraft(t.id),graph=compileDraftToFlow(c);
  assert.equal(graph.schemaVersion,FLOW_DSL_VERSION);
  assert.equal(graph.templateId,t.id);assert.equal(graph.regulated,t.regulated);
  assert.equal(graph.callable,false);assert.equal(graph.nodes[0].type,'greeting');
  assert.equal(graph.nodes.at(-1).type,'end_call');
  assert.equal(graph.nodes.filter(x=>x.type==='ask_text_bounded').length,c.questions.length);
  assert.equal(validateFlowGraph(graph),graph);
  assert.ok(!JSON.stringify(graph).includes('providerUrl'));
 }
});
test('school fictional replies are visible and never treated as real phone outcomes',()=>{
 const graph=compileDraftToFlow(defaultIndustryAgentDraft('school_admission_v1'));
 const r=simulateFlowGraph(graph,{answers:['Yes','Class 5','Please call the guardian']});
 assert.equal(r.status,'simulated_complete');assert.equal(r.answersUsed,3);
 assert.equal(r.simulated,true);assert.equal(r.callable,false);assert.equal(r.providerRequests,0);
 assert.equal(r.crmMutations,0);assert.equal(r.whatsappMessages,0);
 assert.equal(r.transcript.filter(x=>x.speaker==='fictional_customer').length,3);
 assert.equal(r.transcript[0].speaker,'draft_ai');
 const partial=simulateFlowGraph(graph,{answers:['Yes']});
 assert.equal(partial.status,'awaiting_fictional_answer');
 assert.equal(partial.answersUsed,1);
 assert.equal(simulateFlowGraph(graph,{answers:['Yes','Class 5','Please call']}).status,'simulated_complete');
 assert.throws(()=>simulateFlowGraph(graph,{answers:['Yes','Class 5','a'.repeat(161)]}),/fictional_answers/);
 assert.equal(simulateFlowGraph(graph,{answers:['Yes','Class 5','']}).status,'invalid_fictional_answer');
 assert.throws(()=>simulateFlowGraph(graph,{answers:Array(13).fill('yes')}),/fictional_answers/);
});
test('regulated drafts never read or render payment, due amount, policy details or account data',()=>{
 for(const id of ['finance_due_notice_v1','banking_service_v1','insurance_renewal_v1']){
  const graph=compileDraftToFlow(defaultIndustryAgentDraft(id));
  const r=simulateFlowGraph(graph);
  assert.equal(r.status,'simulated_complete');assert.equal(r.answersUsed,0);
  assert.ok(r.transcript.every(x=>x.speaker==='draft_ai'));
  assert.ok(r.effects.every(x=>!x.startsWith('account_lookup')));
  assert.doesNotMatch(JSON.stringify(r),/4250|loan_account_ref|card_number|customer_mobile/);
 }
});
test('invalid graph nodes, hidden edges, loops, foreign templates and activation attempts are rejected',()=>{
 const original=compileDraftToFlow(defaultIndustryAgentDraft('school_admission_v1'));
 for(const mutate of [
  x=>{x.callable=true},
  x=>{x.nodes.push({...x.nodes[1]})},
  x=>{x.nodes[1].next='q_1'},
  x=>{x.nodes[1].next='unknown'},
  x=>{x.nodes[1].providerUrl='https://evil.example'},
  x=>{x.nodes.push({id:'evil',type:'end_call'})},
  x=>{x.nodes[1].type='execute_sql'},
  x=>{x.nodes[1].maxLength=10000},
  x=>{x.industry='finance'},
  x=>{x.schemaVersion=100},
  x=>{x.nodes[0].next='end';x.nodes[1].next='closing'},
  x=>{x.nodes[0].text='bad'+String.fromCodePoint(0x202e)+' bidi'}
 ]){
  const copy=duplicate(original);mutate(copy);
  assert.throws(()=>validateFlowGraph(copy));
 }
});
test('private field is always downstream of verification AND fresh source data',()=>{
 const t=defaultIndustryAgentDraft('finance_due_notice_v1');
 const graph=compileDraftToFlow(t);
 const g=duplicate(graph);
 g.nodes=[
  {id:'start',type:'greeting',text:t.greeting,next:'verify'},
  {id:'verify',type:'verify_recipient',onVerified:'fresh',onFailure:'generic_end'},
  {id:'fresh',type:'fetch_approved_snapshot',resource:'finance_account',onFresh:'sensitive',onUnavailable:'generic_end'},
  {id:'sensitive',type:'speak_verified_field',fields:['amount_due','due_date'],next:'end'},
  {id:'generic_end',type:'speak_static',text:'Contact authorized support.',next:'end'},
  {id:'end',type:'end_call'}
 ];
 assert.equal(validateFlowGraph(g),g);
 const result=simulateFlowGraph(g);
 assert.equal(result.status,'simulated_complete');
 assert.equal(result.transcript.some(x=>x.text.includes('amount_due')),false);
 assert.deepEqual(result.effects,['recipient_not_verified_in_demo']);
 const bad=duplicate(g);bad.nodes[0].next='fresh';
 assert.throws(()=>validateFlowGraph(bad),/private_field_missing_verification_or_freshness/);
 const bad2=duplicate(g);bad2.nodes[1].onVerified='sensitive';
 assert.throws(()=>validateFlowGraph(bad2),/private_field_missing_verification_or_freshness/);
});
test('branch and synthetic human-review nodes are deterministic and have no actual CRM effects',()=>{
 const t=defaultIndustryAgentDraft('school_admission_v1'),g=compileDraftToFlow(t);
 g.nodes=[
  {id:'start',type:'greeting',text:'Fictional admission enquiry',next:'ask'},
  {id:'ask',type:'ask_choice',text:'Interested?',field:'interest',choices:['yes','no'],next:'branch'},
  {id:'branch',type:'branch_exact',source:'interest',branches:{yes:'task'},otherwise:'save'},
  {id:'task',type:'create_human_task',kind:'admission_callback',next:'end'},
  {id:'save',type:'save_reviewed_outcome',outcome:'not_interested',next:'end'},
  {id:'end',type:'end_call'}
 ];
 validateFlowGraph(g);
 const yes=simulateFlowGraph(g,{answers:['yes']});
 assert.deepEqual(yes.effects,['would_create_human_task:admission_callback']);
 const no=simulateFlowGraph(g,{answers:['no']});
 assert.deepEqual(no.effects,['would_save_outcome:not_interested']);
 assert.equal(no.crmMutations,0);
 assert.equal(simulateFlowGraph(g,{answers:['maybe']}).status,'invalid_fictional_answer');
});
test('simulator API is protected, tenant-scoped, admin-only, no customer/provider changes',async()=>{
 const f=fixture();
 try{
  const id=storedDraft(f,defaultIndustryAgentDraft('school_admission_v1')),
   client=await newSession(f.env.CONTROL_DB,'client'),
   viewer=await newSession(f.env.CONTROL_DB,'viewer');
  const target='/v1/human/ai-flows/'+id+'/simulate',body={tenantId:tid,answers:['Yes','5','Please call']};
  const result=await call(f,client,target,'POST',body);
  assert.equal(result.status,200,await result.clone().text());
  const data=await result.json();assert.equal(data.status,'simulated_complete');
  assert.equal(data.flow.callable,false);assert.equal(data.flow.regulated,false);
  assert.equal(data.providerRequests,0);assert.equal(data.crmMutations,0);
  assert.equal((await call(f,viewer,target,'POST',body)).status,403);
  assert.equal((await call(f,client,target,'POST',{...body,tenantId:foreign})).status,403);
  assert.equal((await call(f,client,target,'POST',body,false)).status,403);
  assert.equal((await call(f,client,target)).status,405);
  assert.equal((await call(f,client,'/v1/human/ai-flows/publish','POST',body)).status,404);
  assert.equal((await call(f,client,target,'POST',{...body,ignored:'unsafe'})).status,400);
  assert.equal((await call(f,client,target,'POST',{...body,answers:[('x'.repeat(161))]})).status,400);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  assert.equal(f.c.db.prepare('SELECT revision FROM ai_flow_definitions WHERE id=?').get(id).revision,1);
 }finally{f.close()}
});
test('simulator is present in UI with explicit fictional-data warning and no provider link',async()=>{
 const vm=await import('node:vm');
 assert.doesNotThrow(()=>new vm.Script(js));
 const index=js.indexOf('function industryAgentPanel('),source=js.slice(index,js.indexOf('function industryAgentPanel(')+14000);
 assert.match(source,/Fictional conversation answers/);
 assert.match(source,/Run fictional conversation \(no calls\)/);
 assert.match(source,/\/simulate/);
 assert.doesNotMatch(source,/\/v1\/human\/calling\/runs|\/v1\/provider\/|\/v1\/human\/scripted-phone-pilot/);
});
