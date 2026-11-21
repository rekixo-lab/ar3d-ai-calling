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
function provider({paused=false,unsafeTraffic=false,wrongCandidate=false,missingAgent=false}={}){
 let writes=0,reads=0;
 const agent={id:'provider-assigned',instruction:prompt,tools:[],mcp_tools:[],llm_config:{model_id:'model-one'}};
 const fetcher=async(url,init)=>{
  const u=new URL(url),p=u.pathname,v=u.searchParams.get('version');
  assert.equal(init.method,'GET');reads++;
  if(p.endsWith('/voicebots/'+bot)){
   if(v==='v2')return Response.json({response:{id:bot,version:'v2',assistant_config:{id:template,version:'v1'}}});
   if(v==='v3')return Response.json({response:{id:bot,version:'v3',assistant_config:{
    id:wrongCandidate?template:guard,version:'v4'
   }}});
   return Response.json({response:{
    id:bot,stable_version:'v2',latest_version:paused?'v3':'v2',
    traffic_allocation:paused?{v2:unsafeTraffic?90:100,v3:unsafeTraffic?10:0}:{v2:100}
   }});
  }
  if(p.endsWith('/assistants/'+guard)){
   const agents=missingAgent?[]:[agent];
   if(v==='v4')return Response.json({response:{
    id:guard,version:'v4',stable_version:'v4',latest_version:'v4',instruction:prompt,agents
   }});
   if(v==='stable')return Response.json({response:{
    id:guard,version:'v4',stable_version:'v4',latest_version:'v4',instruction:prompt,agents
   }});
   return Response.json({response:{id:guard,stable_version:'v4',latest_version:'v4',versions:{v4:{agents}}}});
  }
  throw Error('unexpected read: '+p);
 };
 return {fetcher,get reads(){return reads},get writes(){return writes}};
}
test('post-Guard-write lock can read v4 safe Agent without an Exotel or D1 mutation',async()=>{
 const f=fixture();try{
  seed(f,'guard_agent_fix_unknown');const p=provider();
  assert.equal((await handleVoiceGatewayRequest(action(),f.env,client,{now,fetcher:p.fetcher})).status,403);
  const before=f.c.db.prepare('SELECT state,error_code,gateway_version FROM shared_voice_gateway WHERE id=1').get();
  const res=await handleVoiceGatewayRequest(action(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200,await res.clone().text());
  const d=await res.json();
  assert.equal(d.outcome,'saved_guard_verified_bot_not_staged');
  assert.equal(d.guard.latestVersion,'v4');
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
