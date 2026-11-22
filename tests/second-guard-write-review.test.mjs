import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {handleVoiceGatewayRequest} from '../src/voice-gateway-routes.mjs';

const bot='66cbf4f6-a52d-4df0-abf0-db5e3b365836';
const guard='55555555-5555-4555-8555-555555555555';
const template='66666666-6666-4666-8666-666666666666';
const prompt='You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.';
const action=()=>new Request('https://app.example.invalid/v1/human/voice-gateway',{
 method:'POST',headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},
 body:JSON.stringify({action:'repair-review'})
});
function seed(f,error){
 f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,gateway_version,state,error_code,updated_by,updated_at) VALUES(1,?,?,?,?,?,NULL,'unknown',?,'admin',?)")
 .run(bot,'1393135',template,'v1',guard,error,at);
}
function provider({paused=false,unsafeTraffic=false,wrongCandidate=false,missingAgent=false,
 traffic,botUnavailable=false,guardUnavailable=false,wrongBotVersion=false,wrongTemplateVersion=false,
 wrongGuardVersion=false,nested=false,model='model-one',unsafeInstructions=false,unsafeTools=false,
 conflict=false,settingChanged=false}={}){
 const gets=[],unexpected=[];
 const agent={id:'provider-assigned',instruction:unsafeInstructions?'PRIVATE_WRONG_PROMPT':prompt,
  tools:[],mcp_tools:unsafeTools?[{name:'private-tool'}]:[],llm_config:{model_id:model}};
 const reply=data=>Response.json({response:{data}});
 const fetcher=async(url,init)=>{
  const u=new URL(url),p=u.pathname,v=u.searchParams.get('version');
  if(init.method!=='GET'||p.includes('/calls')){
   unexpected.push({method:init.method,path:p});
   throw Error('unexpected provider operation');
  }
  gets.push(p+u.search);
  if(p.endsWith('/voicebots/'+bot)){
   if(botUnavailable)return new Response('PRIVATE_PROVIDER_ERROR',{status:502});
   if(v==='v2')return reply({id:bot,version:'v2',tts_config:{enabled:true},
    assistant_config:{id:template,version:wrongTemplateVersion?'v2':'v1'}});
   if(v==='v3'){
    const cfg={assistant_config:{assistant_id:wrongCandidate?template:guard,
     assistant_version:wrongGuardVersion?'v3':'v4'},tts_config:{enabled:!settingChanged}};
    return reply({id:bot,version:wrongBotVersion?'v2':'v3',...(nested?{versions:{v3:cfg}}:cfg)});
   }
   return reply({id:bot,stable_version:'v2',latest_version:paused?'v3':'v2',
    traffic_allocation:traffic!==undefined?traffic:paused?
     {v2:unsafeTraffic?90:100,v3:unsafeTraffic?10:0}:{v2:100}});
  }
  if(p.endsWith('/assistants/'+template)&&v==='v1')
   return reply({id:template,version:'v1',agents:[{llm_config:{model_id:'model-one'}}]});
  if(p.endsWith('/assistants/'+guard)){
   if(guardUnavailable)return new Response('PRIVATE_GUARD_ERROR',{status:503});
   const agents=missingAgent?[]:[agent];
   if(v==='v4'||v==='stable'){
    const cfg={instruction:prompt,agents};
    return reply({id:guard,version:'v4',stable_version:'v4',latest_version:'v4',
     ...(nested?{versions:{v4:cfg}}:cfg),...(conflict&&v==='v4'?{agents:[]}:{}),
     ...(conflict&&v==='v4'?{versions:{v4:cfg}}:{})});
   }
   if(v==='v3')return reply({id:guard,version:'v3',stable_version:'v4',latest_version:'v4',
    instruction:prompt,agents:[]});
   return reply({id:guard,stable_version:'v4',latest_version:'v4',versions:{v3:{agents:[]},v4:{agents}}});
  }
  throw Error('unexpected read: '+p);
 };
 return {fetcher,gets,get writes(){return unexpected.length}};
}
test('post-Guard-write lock can read v4 safe Agent without an Exotel or D1 mutation',async()=>{
 const f=fixture();try{
  seed(f,'guard_agent_fix_unknown');const p=provider();
  assert.equal((await handleVoiceGatewayRequest(action(),f.env,client,{now,fetcher:p.fetcher})).status,403);
  assert.equal((await handleVoiceGatewayRequest(action(),f.env,{...admin,token_hash:'bad'},{now,fetcher:p.fetcher})).status,403);
  assert.equal(p.gets.length,0);
  const before=f.c.db.prepare('SELECT state,error_code,gateway_version FROM shared_voice_gateway WHERE id=1').get();
  const res=await handleVoiceGatewayRequest(action(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200,await res.clone().text());
  const d=await res.json();
  assert.equal(d.outcome,'saved_guard_verified_bot_not_staged');
  assert.equal(d.guard.latestVersion,'v4');
  assert.equal(d.savedErrorCode,'guard_agent_fix_unknown');
  assert.equal(d.guard.versions.find(v=>v.selectedVersion==='v3').agentCount,'zero');
  assert.equal(d.guard.stable.agentCount,'one');
  assert.equal(d.guard.stable.strictGuardVerified,true);
  assert.equal(d.sharedVoicebot.stableTrafficPreserved,true);
  assert.equal(d.sharedVoicebot.pausedCandidatePresent,false);
  assert.equal(d.writeOperationsAllowed,false);assert.equal(p.writes,0);
  assert.deepEqual(f.c.db.prepare('SELECT state,error_code,gateway_version FROM shared_voice_gateway WHERE id=1').get(),before);
 }finally{f.close()}
});
test('post-Bot-write lock detects a paused 0% candidate that references exact safe Guard',async()=>{
 const f=fixture();try{
  seed(f,'bot_agent_fix_unknown');const p=provider({paused:true});
  const r=await handleVoiceGatewayRequest(action(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.outcome,'paused_candidate_verified_but_gateway_locked_stop');
  assert.equal(d.guard.stableVersion,'v4');
  assert.equal(d.sharedVoicebot.stableVersion,'v2');
  assert.equal(d.sharedVoicebot.latestVersion,'v3');
  assert.equal(d.sharedVoicebot.unchangedAndPaused,false);
  assert.equal(d.sharedVoicebot.stableTrafficPreserved,true);
  assert.equal(d.sharedVoicebot.pausedCandidatePresent,true);
  assert.equal(d.sharedVoicebot.latestTrafficPercent,0);
  assert.equal(d.sharedVoicebot.stableTrafficPercent,100);
  assert.equal(d.sharedVoicebot.pausedCandidateReferencesGuard,true);
  assert.equal(d.writeOperationsAllowed,false);assert.equal(p.writes,0);
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'bot_agent_fix_unknown');
 }finally{f.close()}
});
test('post-Bot lock refuses mismatched Guard candidate, missing Agent, or traffic changes',async()=>{
 for(const scenario of [
  {paused:true,wrongCandidate:true,expected:'paused_candidate_guard_unverified_stop'},
  {paused:true,missingAgent:true,expected:'paused_candidate_guard_unverified_stop'},
  {paused:true,unsafeTraffic:true,expected:'shared_voicebot_changed_stop'}
 ]){
  const f=fixture();try{
   seed(f,'bot_agent_fix_unknown');const p=provider(scenario);
   const r=await handleVoiceGatewayRequest(action(),f.env,admin,{now,fetcher:p.fetcher});
   assert.equal(r.status,200);const d=await r.json();
   assert.equal(d.outcome,scenario.expected);
   assert.equal(d.writeOperationsAllowed,false);assert.equal(p.writes,0);
   assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
  }finally{f.close()}
 }
});


async function review(opts,error='bot_agent_fix_unknown'){
 const f=fixture();try{
  seed(f,error);const p=provider({paused:true,...opts});
  const before=f.c.db.prepare('SELECT * FROM shared_voice_gateway').get();
  const r=await handleVoiceGatewayRequest(action(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.writeOperationsAllowed,false);
  assert.equal(p.writes,0);
  assert.deepEqual(f.c.db.prepare('SELECT * FROM shared_voice_gateway').get(),before);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  assert.doesNotMatch(JSON.stringify(d),/PRIVATE_|provider-assigned|model-one|private-tool|55555555/);
  return {d,gets:p.gets};
 }finally{f.close()}
}

test('a full allocation of 100% to v2 leaves omitted v3 at 0%; all exact evidence still runs',async()=>{
 const {d,gets}=await review({traffic:{v2:100}});
 assert.equal(d.outcome,'paused_candidate_verified_but_gateway_locked_stop');
 assert.equal(d.sharedVoicebot.stableTrafficPreserved,true);
 assert.equal(d.sharedVoicebot.latestTrafficPercent,0);
 assert.equal(d.sharedVoicebot.trafficStatus,'latest_omitted_from_full_stable_allocation');
 assert.equal(d.sharedVoicebot.pausedCandidatePresent,true);
 assert.equal(d.sharedVoicebot.latestUsesRecordedGuard,true);
 assert.equal(d.guard.stable.strictGuardVerified,true);
 for(const [id,v] of [[bot,'v2'],[bot,'v3'],[guard,'v4'],[guard,'v3'],[guard,'stable']])
  assert.ok(gets.some(p=>p.endsWith(id+'?version='+v)));
});

test('unknown or live candidate traffic does not mask Guard results',async()=>{
 for(const [traffic,status,pct] of [
  [null,'allocation_missing',null],
  [{v2:100,v3:null},'allocation_malformed',null],
  [{v2:100,v3:'0'},'allocation_malformed',null],
  [{v2:100,v3:1},'traffic_outside_stable',1],
  [{v2:90,v3:10},'traffic_outside_stable',10],
  [{v1:0},'stable_allocation_missing',null],
 ]){
  const {d}=await review({traffic});
  assert.equal(d.outcome,'shared_voicebot_changed_stop');
  assert.equal(d.sharedVoicebot.trafficStatus,status);
  assert.equal(d.sharedVoicebot.latestTrafficPercent,pct);
  assert.equal(d.sharedVoicebot.stableTrafficPreserved,pct===null?null:false);
  assert.equal(d.guard.stable.strictGuardVerified,true);
 }
});

test('Bot and Guard read failures preserve the other resource evidence',async()=>{
 const {d:botFailed}=await review({botUnavailable:true});
 assert.equal(botFailed.sharedVoicebot.readError,'provider_http_502');
 assert.equal(botFailed.guard.stable.agentCount,'one');
 const {d:guardFailed}=await review({guardUnavailable:true});
 assert.equal(guardFailed.guard.readError,'provider_http_503');
 assert.equal(guardFailed.sharedVoicebot.latestTrafficPercent,0);
 assert.equal(guardFailed.sharedVoicebot.latestUsesRecordedGuard,true);
 assert.equal(guardFailed.sharedVoicebot.pausedCandidateReferencesGuard,null);
});

test('exact nested version binds safely; wrong readback tag, pin, template version or changed settings stops',async()=>{
 const {d:verified}=await review({nested:true});
 assert.equal(verified.outcome,'paused_candidate_verified_but_gateway_locked_stop');
 assert.equal(verified.guard.stable.versionMapAgentCount,'one');
 const {d:versionUnverified}=await review({wrongBotVersion:true});
 assert.equal(versionUnverified.sharedVoicebot.versionReadErrors.latest,'provider_bot_version_unverified');
 assert.equal(versionUnverified.sharedVoicebot.pausedCandidateReferencesGuard,null);
 const {d:wrongPin}=await review({wrongGuardVersion:true});
 assert.equal(wrongPin.sharedVoicebot.latestUsesRecordedGuard,true);
 assert.equal(wrongPin.sharedVoicebot.latestAssistantVersion,'v3');
 assert.equal(wrongPin.sharedVoicebot.pausedCandidateReferencesGuard,false);
 const {d:templateChanged}=await review({wrongTemplateVersion:true});
 assert.equal(templateChanged.outcome,'shared_voicebot_changed_stop');
 assert.equal(templateChanged.sharedVoicebot.stableTrafficPreserved,true);
 assert.equal(templateChanged.sharedVoicebot.stableTemplateMatches,false);
 const {d:changed}=await review({settingChanged:true});
 assert.deepEqual(changed.sharedVoicebot.changedConfigFields,['tts_config']);
 assert.equal(changed.outcome,'paused_candidate_guard_unverified_stop');
});

test('Guard count conflicts, unsafe content or unexpected model prevent strict verification',async()=>{
 for(const opts of [{conflict:true},{unsafeInstructions:true},{unsafeTools:true},{model:'wrong-model'}]){
  const {d}=await review(opts);
  assert.equal(d.guard.stable.strictGuardVerified,false);
  assert.equal(d.sharedVoicebot.pausedCandidateReferencesGuard,false);
  if(opts.conflict)assert.equal(d.guard.evidence.responseShapeConflict,true);
  if(opts.model)assert.equal(d.guard.stable.agentModelMatches,false);
 }
});

test('paused candidate can be observed with a Guard phase lock without assuming its provenance',async()=>{
 const {d}=await review({},'guard_agent_fix_unknown');
 assert.equal(d.outcome,'paused_candidate_origin_unconfirmed_stop');
 assert.equal(d.sharedVoicebot.pausedCandidatePresent,true);
 assert.equal(d.sharedVoicebot.pausedCandidateReferencesGuard,true);
});
