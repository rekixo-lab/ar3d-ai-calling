import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {handleVoiceGatewayRequest} from '../src/voice-gateway-routes.mjs';
const bot='44444444-4444-4444-8444-444444444444';
const guard='55555555-5555-4555-8555-555555555555';
const template='66666666-6666-4666-8666-666666666666';
const req=()=>new Request('https://app.example.invalid/v1/human/voice-gateway',
 {method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},
  body:JSON.stringify({action:'review'})});
function unknown(f,guardId=guard){
 f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,gateway_version,state,error_code,updated_by,updated_at) VALUES(1,?,?,?,?,?,NULL,'unknown','provider_write_unknown','admin',?)")
 .run(bot,'1393135',template,'v1',guardId,at);
}
test('unknown gateway review reads provider versions without any Exotel or D1 mutation',async()=>{
 const f=fixture();try{
  unknown(f);
  const current=await handleVoiceGatewayRequest(new Request('https://app.example.invalid/v1/human/voice-gateway',{method:'GET'}),f.env,admin,{now});
  assert.equal(current.status,200);
  const status=await current.json();
  assert.equal(status.gateway.state,'unknown');
  assert.equal(status.knownAuthTemplateBotId,'c3c7ca7c-b06d-4b3d-b661-ef121f751021');
  let reads=0,writes=0;
  const fetcher=async(url,init)=>{
   assert.equal(new URL(url).hostname,'voicebot.in.exotel.com');
   if(init.method!=='GET')writes++;
   reads++;
   const u=new URL(url),v=u.searchParams.get('version');
   if(u.pathname.includes('/assistants/')){
    const prompt='You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.';
    return Response.json({response:v==='v2'
     ?{id:guard,version:'v2',stable_version:'v2',instruction:prompt,agents:[{instruction:prompt}],credentials:'never-leak-secret'}
     :{id:guard,latest_version:'v2',stable_version:'v2',credentials:'never-leak-secret'}});
   }
   const result=v==='v3'?{id:bot,version:'v3',assistant_config:{id:guard},credentials:'never-leak-secret'}:
    v==='v2'?{id:bot,version:'v2',assistant_config:{id:template},credentials:'never-leak-secret'}:
    {id:bot,latest_version:'v3',stable_version:'v2',traffic_allocation:{v2:100},credentials:'never-leak-secret'};
   return Response.json({response:result});
  };
  assert.equal((await handleVoiceGatewayRequest(req(),f.env,client,{now,fetcher})).status,403);
  assert.equal((await handleVoiceGatewayRequest(req(),f.env,{...admin,token_hash:'bad'},{now,fetcher})).status,403);
  assert.equal(reads,0);
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher});
  assert.equal(res.status,200,await res.clone().text());
  const raw=await res.text(),d=JSON.parse(raw);
  assert.ok(!raw.includes('never-leak-secret'));
  assert.ok(!raw.includes(f.env.EXOTEL_API_TOKEN));
  assert.equal(d.savedState,'unknown');
  assert.equal(d.guardAssistantRecorded,true);
  assert.equal(d.guardAssistantReadable,true);
  assert.equal(d.guardAssistantStableVersion,'v2');
  assert.equal(d.guardAssistantFinalized,true);
  assert.equal(d.guardVersionContract.responseRootAgentCount,'one');
  assert.equal(d.guardVersionContract.responseSelectedAgentCount,'one');
  assert.equal(d.guardVersionContract.rootInstructionMatchesGuard,true);
  assert.equal(d.guardVersionContract.agentInstructionMatchesGuard,true);
  assert.equal(d.gatewayVersionRecorded,null);
  assert.equal(d.latestVersion,'v3');assert.equal(d.stableVersion,'v2');
  assert.equal(d.providerReadable,true);
  assert.equal(d.latestVersionUsesRecordedGuard,true);
  assert.equal(d.stableVersionUsesRecordedGuard,false);
  assert.match(d.recommendation,/Never retry Prepare/);
  assert.equal(reads,5);assert.equal(writes,0);
  const after=f.c.db.prepare('SELECT state,guard_assistant_id,gateway_version,error_code FROM shared_voice_gateway WHERE id=1').get();
  assert.deepEqual({...after},{state:'unknown',guard_assistant_id:guard,gateway_version:null,error_code:'provider_write_unknown'});
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
 }finally{f.close()}
});
test('a recorded guard without verified final instructions stays unconfirmed',async()=>{
 const f=fixture();try{
  unknown(f);let reads=0,writes=0;
  const fetcher=async(url,init)=>{
   reads++;if(init.method!=='GET')writes++;
   const u=new URL(url),v=u.searchParams.get('version');
   if(u.pathname.includes('/assistants/'))return Response.json({response:v==='v1'
    ?{id:guard,version:'v1',stable_version:'v1',agents:[{instruction:'wrong prompt should not appear in output'}]}
    :{id:guard,stable_version:'v1',latest_version:'v1'}});
   return Response.json({response:v?{id:bot,version:'v2',assistant_config:{id:template}}:
    {id:bot,latest_version:'v2',stable_version:'v2'}});
  };
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher});
  assert.equal(res.status,200);
  const d=await res.json();
  assert.equal(d.guardAssistantReadable,true);
  assert.equal(d.guardAssistantStableVersion,'v1');
  assert.equal(d.guardAssistantFinalized,false);
  assert.equal(d.latestVersionUsesRecordedGuard,false);
  assert.ok(!JSON.stringify(d).includes('wrong prompt'));
  assert.equal(reads,4);assert.equal(writes,0);
  assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
 }finally{f.close()}
});
test('guard read-only inspection reports version-field mismatch without exposing prompt or changing provider',async()=>{
 const f=fixture();try{
  unknown(f);let reads=0,mutations=0;
  const fetcher=async(url,init)=>{
   reads++;if(init.method!=='GET')mutations++;
   const u=new URL(url),isGuard=u.pathname.includes('/assistants/'),selected=u.searchParams.get('version');
   if(isGuard&&selected==='v2')return Response.json({response:{
    id:guard,stable_version:'v2',latest_version:'v3',
    agents:[{instruction:'sensitive guard instructions must never be leaked'}]
   }});
   if(isGuard)return Response.json({response:{id:guard,stable_version:'v2',latest_version:'v3'}});
   if(selected)return Response.json({response:{id:bot,version:'v2',assistant_config:{id:template}}});
   return Response.json({response:{id:bot,stable_version:'v2',latest_version:'v2'}});
  };
  const response=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher});
  assert.equal(response.status,200);
  const serialized=await response.text(),d=JSON.parse(serialized);
  assert.equal(d.guardAssistantReadable,true);
  assert.equal(d.guardAssistantFinalized,null);
  assert.equal(d.guardAssistantReadError,'guard_version_not_confirmed');
  assert.equal(d.guardVersionContract.responseHasRootAgents,true);
  assert.equal(d.guardVersionContract.responseRootAgentCount,'one');
  assert.equal(d.guardVersionContract.responseSelectedAgentCount,'absent');
  assert.equal(d.guardVersionContract.rootInstructionMatchesGuard,null);
  assert.equal(d.guardVersionContract.agentInstructionMatchesGuard,null);
  assert.equal(d.guardVersionContract.responseHasVersionedAgents,false);
  assert.equal(d.guardVersionContract.responseVersionMatchesRequested,false);
  assert.equal(d.guardVersionContract.responseLatestMatchesRequested,false);
  assert.equal(d.guardVersionContract.responseStableMatchesRequested,true);
  assert.ok(!serialized.includes('sensitive guard instructions'));
  assert.equal(d.savedState,'unknown');assert.equal(mutations,0);assert.equal(reads,4);
  assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
 }finally{f.close()}
});

test('stable v2 with a root agents field but zero agents is not finalized or misclassified as a version-label failure',async()=>{
 const f=fixture();try{
  unknown(f);let reads=0,writes=0;
  const fetcher=async(url,init)=>{
   reads++;if(init.method!=='GET')writes++;
   const u=new URL(url),v=u.searchParams.get('version');
   if(u.pathname.includes('/assistants/'))return Response.json({response:v==='v2'
    ?{id:guard,stable_version:'v2',latest_version:'v2',instruction:'unverified secret',agents:[]}
    :{id:guard,stable_version:'v2',latest_version:'v2'}});
   return Response.json({response:v
    ?{id:bot,version:'v2',assistant_config:{id:template}}
    :{id:bot,stable_version:'v2',latest_version:'v2'}});
  };
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher});
  assert.equal(res.status,200);
  const raw=await res.text(),d=JSON.parse(raw);
  assert.equal(d.guardAssistantFinalized,null);
  assert.equal(d.guardAssistantReadError,'guard_version_not_confirmed');
  assert.equal(d.guardVersionContract.responseHasRootAgents,true);
  assert.equal(d.guardVersionContract.responseRootAgentCount,'zero');
  assert.equal(d.guardVersionContract.responseSelectedAgentCount,'zero');
  assert.equal(d.guardVersionContract.rootInstructionMatchesGuard,false);
  assert.equal(d.guardVersionContract.agentInstructionMatchesGuard,null);
  assert.equal(d.guardVersionContract.responseVersionMatchesRequested,false);
  assert.equal(d.guardVersionContract.responseLatestMatchesRequested,true);
  assert.equal(d.guardVersionContract.responseStableMatchesRequested,true);
  assert.ok(!raw.includes('unverified secret'));
  assert.equal(reads,4);assert.equal(writes,0);
  assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
 }finally{f.close()}
});
test('missing guard and provider outage never pretend a gateway is ready',async()=>{
 for(const outage of [false,true]){
  const f=fixture();try{
   unknown(f,null);let calls=0;
   const fetcher=async(url,init)=>{
    calls++;assert.equal(init.method,'GET');
    if(outage)throw Error('provider-secret-from-downstream');
    return Response.json({response:{id:bot,latest_version:'v5',stable_version:'v2'}});
   };
   const r=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher});
   assert.equal(r.status,200);
   const d=await r.json();
   assert.equal(d.savedState,'unknown');
   assert.equal(d.guardAssistantRecorded,false);
   assert.equal(d.latestVersionUsesRecordedGuard,null);
   assert.equal(d.stableVersionUsesRecordedGuard,null);
   assert.equal(d.providerReadable,!outage);
   assert.equal(calls,1);
   assert.ok(!JSON.stringify(d).includes('provider-secret-from-downstream'));
  }finally{f.close()}
 }
});
test('review requires a stored unknown state and never guesses missing versions',async()=>{
 const f=fixture();try{
  let reads=0;
  const fetcher=async()=>{reads++;return Response.json({})};
  const r=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher});
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'gateway_review_requires_unknown_state');
  assert.equal(reads,0);
 }finally{f.close()}
});
