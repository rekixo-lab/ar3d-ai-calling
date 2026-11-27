import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {runVirtualVoiceTurns} from '../src/virtual-voice-turns.mjs';
import {js} from '../src/app-assets.mjs';

const origin='https://app.example.invalid',foreign='77777777-7777-4777-8777-777777777777';
const base='/v1/human/ai-flow-snapshots';
const getPath=(path,tenant=tid)=>path+'?tenantId='+encodeURIComponent(tenant);
function request(f,token,path,method='GET',data,sameOrigin=true){
 return worker.fetch(new Request(origin+path,{method,
  headers:{cookie:COOKIE+'='+token,...(sameOrigin?{origin}:{}),
   ...(data?{'content-type':'application/json'}:{})},
  ...(data?{body:JSON.stringify(data)}:{})}),f.env);
}
async function saved(f,templateId='school_admission_v1'){
 const client=await newSession(f.env.CONTROL_DB,'client');
 const config=defaultIndustryAgentDraft(templateId);
 const created=await request(f,client,'/v1/human/ai-flows','POST',{tenantId:tid,config});
 assert.equal(created.status,201,await created.clone().text());
 const flowId=(await created.json()).draft.id;
 const frozen=await request(f,client,base,'POST',{tenantId:tid,flowId,baseRevision:1});
 assert.equal(frozen.status,201,await frozen.clone().text());
 return {token:client,config,flowId,snapshotId:(await frozen.json()).snapshot.id};
}
test('deterministic virtual voice commands advance one fictional reply at a time',()=>{
 const graph=compileDraftToFlow(defaultIndustryAgentDraft('school_admission_v1'));
 const start=runVirtualVoiceTurns(graph,{answers:[]});
 assert.equal(start.status,'awaiting_fictional_reply');
 assert.equal(start.expectedNode,'q_1');
 assert.deepEqual(start.commands.map(x=>x.kind),
  ['would_speak_reviewed_text','would_speak_reviewed_text','await_fictional_reply']);
 assert.equal(start.answersUsed,0);assert.equal(start.commands.at(-1).questionIndex,1);
 const one=runVirtualVoiceTurns(graph,{answers:['yes']});
 assert.equal(one.status,'awaiting_fictional_reply');
 assert.equal(one.expectedNode,'q_2');
 assert.equal(one.commands.at(-1).questionIndex,2);
 const two=runVirtualVoiceTurns(graph,{answers:['yes','Class 5']});
 assert.equal(two.expectedNode,'q_3');
 const three=runVirtualVoiceTurns(graph,{answers:['yes','Class 5','Please call']});
 assert.equal(three.status,'virtual_preview_complete');
 assert.equal(three.expectedNode,null);
 assert.equal(three.commands.at(-1).kind,'would_end_preview');
 assert.equal(three.transcript.filter(x=>x.speaker==='fictional_person').length,3);
 assert.deepEqual(runVirtualVoiceTurns(graph,{answers:['yes','Class 5','Please call']}),three,
  'same frozen graph and answers must be idempotent');
 for(const state of [start,one,two,three]){
  assert.equal(state.simulated,true);assert.equal(state.liveCall,false);
  assert.equal(state.callable,false);
  assert.deepEqual([state.plivoRequests,state.sarvamRequests,state.r2Requests,
   state.crmMutations,state.whatsappMessages,state.billedSeconds],[0,0,0,0,0,0]);
 }
});
test('announcement mode ends without fabricated recognition, verified data or provider speech',()=>{
 for(const id of ['appointment_reminder_v1','finance_due_notice_v1','banking_service_v1','insurance_renewal_v1']){
  const graph=compileDraftToFlow(defaultIndustryAgentDraft(id));
  const r=runVirtualVoiceTurns(graph,{answers:[]});
  assert.equal(r.status,'virtual_preview_complete');
  assert.equal(r.answersUsed,0);
  assert.ok(r.commands.every(x=>x.kind==='would_speak_reviewed_text'||x.kind==='would_end_preview'));
  assert.equal(r.commands.at(-1).kind,'would_end_preview');
  assert.equal(r.transcript.every(x=>x.speaker==='draft_ai'),true);
  assert.doesNotMatch(JSON.stringify(r),/actual_payment|private_account_lookup|send_whatsapp|provider_voice_url/);
 }
});
test('rejects extra replies, malformed choices, control characters and privacy gate bypasses',()=>{
 const g=compileDraftToFlow(defaultIndustryAgentDraft('school_admission_v1'));
 assert.throws(()=>runVirtualVoiceTurns(g,{answers:['yes','grade 5','call','extra']}),/extra_fictional_answers/);
 assert.throws(()=>runVirtualVoiceTurns(g,{answers:['x'.repeat(161)]}),/fictional_voice_answers/);
 assert.throws(()=>runVirtualVoiceTurns(g,{answers:['bad'+String.fromCodePoint(0x202e)]}),/fictional_voice_answers/);
 assert.throws(()=>runVirtualVoiceTurns(g,{answers:['\n']}),/fictional_voice_answers/);
 assert.throws(()=>runVirtualVoiceTurns(g,{answers:[3]}),/fictional_voice_answers/);
 assert.throws(()=>runVirtualVoiceTurns(g,{answers:Array(13).fill('yes')}),/fictional_voice_answers/);
 const branch={...g,nodes:[
  {id:'start',type:'greeting',text:'Fictional school',next:'ask'},
  {id:'ask',type:'ask_choice',text:'Interested?',field:'interest',choices:['yes','no'],next:'decide'},
  {id:'decide',type:'branch_exact',source:'interest',branches:{yes:'task'},otherwise:'reject'},
  {id:'task',type:'create_human_task',kind:'admission_callback',next:'end'},
  {id:'reject',type:'save_reviewed_outcome',outcome:'not_interested',next:'end'},
  {id:'end',type:'end_call'}
 ]};
 assert.deepEqual(runVirtualVoiceTurns(branch,{answers:['yes']}).effects,['hypothetical_human_task:admission_callback']);
 assert.deepEqual(runVirtualVoiceTurns(branch,{answers:['no']}).effects,['hypothetical_outcome:not_interested']);
 assert.throws(()=>runVirtualVoiceTurns(branch,{answers:['maybe']}),/fictional_voice_choice/);
 const base=compileDraftToFlow(defaultIndustryAgentDraft('finance_due_notice_v1'));
 const finance={...base,nodes:[
  {id:'start',type:'greeting',text:'Generic service notification',next:'verify'},
  {id:'verify',type:'verify_recipient',onVerified:'refresh',onFailure:'generic'},
  {id:'refresh',type:'fetch_approved_snapshot',resource:'finance_account',onFresh:'sensitive',onUnavailable:'generic'},
  {id:'sensitive',type:'speak_verified_field',fields:['amount_due','due_date'],next:'end'},
  {id:'generic',type:'speak_static',text:'Please contact official service.',next:'end'},
  {id:'end',type:'end_call'}
 ]};
 const denied=runVirtualVoiceTurns(finance,{answers:[]});
 assert.equal(denied.status,'virtual_preview_complete');
 assert.deepEqual(denied.effects,['identity_verification_not_performed']);
 assert.doesNotMatch(JSON.stringify(denied),/amount_due|due_date|masked_account_ref/);
 const invalid=structuredClone(finance);
 invalid.nodes[0].next='sensitive';
 assert.throws(()=>runVirtualVoiceTurns(invalid),/private_field_missing_verification_or_freshness/);
});
test('authenticated frozen voice preview is tenant-isolated and does not write calling or finances',async()=>{
 const f=fixture();
 try{
  const s=await saved(f),viewer=await newSession(f.env.CONTROL_DB,'viewer'),
   admin=await newSession(f.env.CONTROL_DB,'admin');
  const path=base+'/'+s.snapshotId+'/voice-turn-preview';
  const payload={tenantId:tid,answers:['yes','Class 5','Please call']};
  const before=f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_audit_events').get().n;
  const result=await request(f,s.token,path,'POST',payload);
  assert.equal(result.status,200,await result.clone().text());
  const data=await result.json();
  assert.equal(data.snapshot.id,s.snapshotId);
  assert.equal(data.snapshot.liveApproved,false);
  assert.equal(data.status,'virtual_preview_complete');
  assert.equal(data.providerRequests,0);
  assert.equal(data.plivoRequests,0);
  assert.equal(data.r2Requests,0);
  assert.equal(data.billedSeconds,0);
  const replay=await request(f,s.token,path,'POST',payload);
  assert.deepEqual(await replay.json(),data);
  const blank=await request(f,s.token,path,'POST',{tenantId:tid,answers:[]});
  assert.equal((await blank.json()).status,'awaiting_fictional_reply');
  assert.equal((await request(f,viewer,path,'POST',payload)).status,403);
  assert.equal((await request(f,admin,path,'POST',payload)).status,403);
  assert.equal((await request(f,s.token,path,'POST',{tenantId:foreign,answers:[]})).status,403);
  assert.equal((await request(f,s.token,path)).status,405);
  assert.equal((await request(f,s.token,path,'POST',payload,false)).status,403);
  for(const malformed of [
   {...payload,provider:'plivo'},
   {...payload,cursor:'closing'},
   {...payload,verified:true},
   {...payload,tenantId:tid,answers:['x'.repeat(161)]}
  ])assert.equal((await request(f,s.token,path,'POST',malformed)).status,400);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_audit_events').get().n,before);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_cost_reservations').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});
test('virtual turns are pinned to frozen source and unchanged after a draft edit',async()=>{
 const f=fixture();
 try{
  const s=await saved(f),path=base+'/'+s.snapshotId+'/voice-turn-preview';
  const before=await request(f,s.token,path,'POST',{tenantId:tid,answers:[]});
  assert.equal(before.status,200);const old=await before.json();
  const revised={...s.config,greeting:'A different fictional admissions greeting'};
  const edit=await request(f,s.token,'/v1/human/ai-flows/'+s.flowId,'PATCH',
   {tenantId:tid,baseRevision:1,config:revised});
  assert.equal(edit.status,200);
  const after=await request(f,s.token,path,'POST',{tenantId:tid,answers:[]});
  assert.deepEqual(await after.json(),old);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM ai_flow_snapshots').get().n,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM ai_flow_preview_reviews').get().n,0);
 }finally{f.close()}
});
test('browser UI exposes virtual turn preview and no provider call control',async()=>{
 const vm=await import('node:vm');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/Preview virtual voice turns \(no calls\)/);
 assert.match(js,/Virtual voice adapter commands \(text only\)/);
 const a=js.indexOf('function industryAgentPanel('),b=js.indexOf('\n}\n',a);
 assert.ok(b>a);
 const ui=js.slice(a,b+2);
 assert.match(ui,/\/voice-turn-preview/);
 assert.doesNotMatch(ui,/\/v1\/provider\/|\/v1\/human\/calling\/runs|\/v1\/human\/whatsapp\/send/);
});
