import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import vm from 'node:vm';
import {simulatorHtml,simulatorJs} from '../src/simulator-ui.mjs';
import {beginSimulation} from '../src/conversation-core.mjs';
import {makeSpeechPlan,processTypedTranscript} from '../src/voice-core.mjs';
const tenantId='22222222-2222-4222-8222-222222222222';
const agentId='33333333-3333-4333-8333-333333333333';
const alien='44444444-4444-4444-8444-444444444444';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function req(path,method='GET',data,origin=true){
  return new Request('https://example.test'+path,{method,headers:{cookie,
    ...(origin?{origin:'https://example.test'}:{}),...(data?{'content-type':'application/json'}:{})},
    body:data?JSON.stringify(data):undefined});
}
function fixture(role='client_admin'){
  let row=null;const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...args){log.push({sql,args,db:'control'});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'user',email:'demo@example.test',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return args[0]===tenantId&&role?
        {tenant_id:tenantId,role,storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...args){log.push({sql,args,db:'crm'});return {
    async first(){
      if(sql.includes('FROM agents WHERE'))return {id:agentId,languageMode:'hi-en',
        questionsJson:'["कहाँ प्लॉट चाहिए?","आपका बजट कितना है?"]'};
      if(sql.includes('FROM conversation_simulations WHERE'))return row&&args[0]===tenantId&&args[1]===row.id?
        {stateJson:row.stateJson,revision:row.revision,expiresAt:row.expiresAt}:null;
      if(sql.includes('UPDATE conversation_simulations')){
        if(!row||args[2]!==tenantId||args[3]!==row.id||args[4]!==row.revision)return null;
        row.stateJson=args[0];row.revision+=1;return {revision:row.revision};
      }
      return null;
    },
    async run(){
      if(sql.includes('INSERT INTO conversation_simulations')){
        row={id:args[1],stateJson:args[4],revision:1,expiresAt:args[8]};
      }return {meta:{changes:1}};
    }
  }}}}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
const demo={languageMode:'hi-en',questions:['कहाँ प्लॉट चाहिए?','What is your budget?']};
test('speech plan provides text and locale hints only, never audio or a provider connection',()=>{
  const plan=makeSpeechPlan(beginSimulation(demo));
  assert.equal(plan.mode,'synthetic_preview_only');
  assert.equal(plan.audioGenerated,false);
  assert.equal(plan.provider,'none');
  assert.equal(plan.transcriptVerified,false);
  assert.ok(plan.segments.some(x=>x.locale==='hi-IN'));
  assert.ok(plan.segments.some(x=>x.locale==='en-IN'));
});
test('English-only and Hindi-only agent speech hints remain locale-scoped',()=>{
  for(const [languageMode,locale] of [['en','en-IN'],['hi','hi-IN']]){
    const plan=makeSpeechPlan(beginSimulation({languageMode,questions:['Question?']}));
    assert.ok(plan.segments.every(s=>s.locale===locale));
  }
});
test('invalid, oversized and control-char text cannot enter a speech plan',()=>{
  const s=beginSimulation(demo);s.turns[0].text='a'.repeat(3000);
  assert.throws(()=>makeSpeechPlan(s),/invalid/);
  s.turns[0].text='x\u0000y';
  assert.throws(()=>makeSpeechPlan(s),/invalid/);
});
test('low-confidence and silent speech preview do not consume question or persist answers',()=>{
  const state=beginSimulation(demo);
  for(const data of [{source:'typed_demo',confidence:0.2,transcript:'Indore'},
    {source:'typed_demo',confidence:0.9,transcript:'  '}]){
    const out=processTypedTranscript(state,data);
    assert.equal(out.action,'repeat_requested');assert.equal(out.mutated,false);
    assert.equal(out.state,state);assert.equal(state.answers.length,0);
  }
});
test('typed transcript advances simulation safely and opt-out ends demo only',()=>{
  let s=beginSimulation(demo);
  const out=processTypedTranscript(s,{source:'typed_demo',confidence:0.95,transcript:'Indore'});
  assert.equal(out.action,'advanced');
  s=out.state;assert.equal(s.answers[0].answer,'Indore');
  const stop=processTypedTranscript(s,{source:'typed_demo',confidence:0.99,transcript:'stop calling'});
  assert.equal(stop.action,'demo_stopped');assert.equal(stop.state.status,'opted_out');
});
test('rejects fake ASR provider, invalid confidence, extra fields and oversized transcript',()=>{
  const state=beginSimulation(demo);
  for(const bad of [{source:'provider',transcript:'abc',confidence:1},
    {source:'typed_demo',transcript:'abc',confidence:1.2},
    {source:'typed_demo',transcript:'abc',confidence:NaN},
    {source:'typed_demo',transcript:'a'.repeat(501),confidence:1},
    {source:'typed_demo',transcript:'abc',confidence:0.8,phoneNumber:'1234'}])
    assert.throws(()=>processTypedTranscript(state,bad),/invalid|typed demo/);
});
test('voice-plan request requires signed-in tenant membership and does not write calls',async()=>{
  const f=fixture('viewer'),base=(await (await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),fixture().env)).json());
  // New simulation must be created in the same CRM fixture as the subsequent lookup.
  const own=fixture();
  const newSim=await (await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),own.env)).json();
  const url='/v1/human/simulations/'+newSim.id+'/voice-preview?tenantId='+tenantId;
  const r=await worker.fetch(req(url),own.env);
  assert.equal(r.status,200);
  const result=await r.json();
  assert.equal(result.revision,1);assert.equal(result.speech.audioGenerated,false);
  assert.equal(result.speech.provider,'none');
  assert.ok(!own.log.some(x=>/INSERT INTO calls|UPDATE leads/.test(x.sql)));
  assert.equal((await worker.fetch(req('/v1/human/simulations/'+newSim.id+'/voice-preview?tenantId='+alien),own.env)).status,403);
  const noCookie=new Request('https://example.test'+url);
  assert.equal((await worker.fetch(noCookie,own.env)).status,401);
});
test('speech turn is demo-only and optimistic-concurrency guarded',async()=>{
  const f=fixture(),created=await (await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),f.env)).json();
  const url='/v1/human/simulations/'+created.id+'/speech-turn';
  const low=await worker.fetch(req(url,'POST',{tenantId,expectedRevision:1,
    recognition:{source:'typed_demo',transcript:'Indore',confidence:0.4}}),f.env);
  assert.equal(low.status,200);const lowResult=await low.json();
  assert.equal(lowResult.action,'repeat_requested');assert.equal(lowResult.revision,1);
  assert.ok(!f.log.some(x=>x.sql.includes('UPDATE conversation_simulations')));
  const next=await worker.fetch(req(url,'POST',{tenantId,expectedRevision:1,
    recognition:{source:'typed_demo',transcript:'Indore',confidence:0.95}}),f.env);
  assert.equal(next.status,200);const ok=await next.json();
  assert.equal(ok.revision,2);assert.equal(ok.simulation.answers[0].answer,'Indore');
  const stale=await worker.fetch(req(url,'POST',{tenantId,expectedRevision:1,
    recognition:{source:'typed_demo',transcript:'Next',confidence:0.95}}),f.env);
  assert.equal(stale.status,409);
  assert.ok(f.log.filter(x=>x.db==='crm').every(x=>x.args.includes(tenantId)));
  assert.ok(!f.log.some(x=>/INSERT INTO calls|UPDATE leads|consent_status|dnd_status/.test(x.sql)));
});
test('speech-turn disallows viewer, no-origin, forged tenant and provider claims',async()=>{
  const f=fixture('viewer'),dummy='11111111-1111-4111-8111-111111111111';
  const url='/v1/human/simulations/'+dummy+'/speech-turn';
  const data={tenantId,expectedRevision:1,recognition:{source:'typed_demo',transcript:'test',confidence:0.9}};
  assert.equal((await worker.fetch(req(url,'POST',data),f.env)).status,403);
  assert.equal((await worker.fetch(req(url,'POST',data,false),fixture().env)).status,403);
  assert.equal((await worker.fetch(req(url,'POST',{...data,tenantId:alien}),fixture().env)).status,403);
  const own=fixture(),s=await (await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),own.env)).json();
  const fake=await worker.fetch(req('/v1/human/simulations/'+s.id+'/speech-turn','POST',
    {...data,recognition:{source:'provider',transcript:'hello',confidence:0.9}}),own.env);
  assert.equal(fake.status,400);
});

test('simulator speech-preview UI is syntactically valid and labeled text-only',()=>{
  assert.doesNotThrow(()=>new vm.Script(simulatorJs));
  assert.match(simulatorHtml,/id="preview-speech"/);
  assert.match(simulatorHtml,/No microphone or audio is generated/);
  assert.match(simulatorJs,/voice-preview\?tenantId=/);
});
