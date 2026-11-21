import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {handleVoiceGatewayRequest} from '../src/voice-gateway-routes.mjs';
const bot='66cbf4f6-a52d-4df0-abf0-db5e3b365836';
const guard='55555555-5555-4555-8555-555555555555';
const template='66666666-6666-4666-8666-666666666666';
const prompt='You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.';
const req=(confirmation='REPAIR_ONLY_SHARED_GUARD_NO_CALLS')=>new Request('https://app.example.invalid/v1/human/voice-gateway',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},body:JSON.stringify({action:'recover',confirmation})});
const unknown=f=>f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,gateway_version,state,error_code,updated_by,updated_at) VALUES(1,?,?,?,?,?,NULL,'unknown','provider_write_unknown','admin',?)").run(bot,'1393135',template,'v1',guard,at);
function provider({failAfterGuardWrite=false,alreadySafe=false,changedBot=false,unsafeTemplate=false,persistGuardBeforeFailure=false}={}){
 let writes=[],reads=[],guardStable='v2',botLatest=changedBot?'v3':'v2',versionedGuard=null;
 const fetcher=async(raw,opts)=>{
  const u=new URL(raw),path=u.pathname,ver=u.searchParams.get('version'),method=opts.method;
  assert.equal(u.hostname,'voicebot.in.exotel.com');
  if(method==='POST'){
   const body=JSON.parse(opts.body),record={path,body};writes.push(record);
   assert.ok(!path.includes('c3c7ca7c'), 'old working bot must never be touched');
   assert.ok(!path.includes('/calls'), 'no calls permitted');
   if(path.endsWith('/assistants/'+guard+'/versions')){
    assert.equal(body.mark_as_stable,'true');assert.equal(body.source_version,'v2');
    assert.equal(body.data.instruction,prompt);
    assert.equal(body.data.agents.length,1);assert.equal(body.data.agents[0].instruction,prompt);
    if(failAfterGuardWrite&&!persistGuardBeforeFailure)throw Error('simulated postwrite timeout');
    versionedGuard=body.data;guardStable='v3';
    if(failAfterGuardWrite)throw Error('simulated postwrite timeout after save');
    return Response.json({response:{version:'v3'}});
   }
   if(path.endsWith('/voicebots/'+bot+'/versions')){
    assert.equal(body.mark_as_stable,'false');assert.equal(body.source_version,'v2');
    assert.equal(body.data.assistant_config.id,guard);
    assert.equal(body.data.assistant_config.version,guardStable);
    botLatest='v3';
    return Response.json({response:{version:'v3'}});
   }
   throw Error('unexpected provider POST '+path);
  }
  assert.equal(method,'GET');reads.push(path+u.search);
  if(path.endsWith('/assistants/'+template)&&ver==='v1')return Response.json({response:{
   id:template,version:'v1',latest_version:'v1',stable_version:'v1',
   instruction:'safe template',llm_config:{model_id:'m1'},agents:unsafeTemplate?[]:[{id:template,instruction:'template script',tools:[],mcp_tools:[]}]
  }});
  if(path.endsWith('/assistants/'+guard)){
   if(ver===guardStable&&guardStable==='v3')return Response.json({response:{
    id:guard,version:'v3',latest_version:'v3',stable_version:'v3',
    instruction:versionedGuard.instruction,llm_config:versionedGuard.llm_config,
    agents:versionedGuard.agents
   }});
   if(ver==='v2')return Response.json({response:{
    id:guard,latest_version:'v2',stable_version:'v2',
    ...(alreadySafe?{instruction:prompt,agents:[{instruction:prompt,tools:[],mcp_tools:[]}]}:
      {instruction:'draft',agents:[]})
   }});
   return Response.json({response:{id:guard,stable_version:guardStable,latest_version:guardStable}});
  }
  if(path.endsWith('/voicebots/'+bot)){
   if(ver==='v2')return Response.json({response:{id:bot,version:'v2',stable_version:'v2',assistant_config:{id:template,version:'v1'}}});
   if(ver==='v3')return Response.json({response:{id:bot,version:'v3',assistant_config:{id:guard,version:guardStable}}});
   return Response.json({response:{id:bot,latest_version:botLatest,stable_version:'v2',
    traffic_allocation:{v2:100,...(botLatest==='v3'?{v3:0}:{})}}});
  }
  throw Error('unexpected provider GET '+path);
 };
 return {fetcher,writes,reads};
}

const previewReq=()=>new Request('https://app.example.invalid/v1/human/voice-gateway',{method:'POST',
 headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},
 body:JSON.stringify({action:'repair-preview'})});
test('zero-agent Guard v2 read-only preview confirms stored template is reusable without any writes',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider();
  const before=f.c.db.prepare('SELECT state,guard_assistant_id,gateway_version,error_code FROM shared_voice_gateway WHERE id=1').get();
  assert.equal((await handleVoiceGatewayRequest(previewReq(),f.env,client,{now,fetcher:p.fetcher})).status,403);
  assert.equal((await handleVoiceGatewayRequest(previewReq(),f.env,{...admin,token_hash:'bad'},{now,fetcher:p.fetcher})).status,403);
  assert.equal(p.reads.length,0);
  const res=await handleVoiceGatewayRequest(previewReq(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.deepEqual(data,{eligible:true,reason:'preflight_checks_passed',
   plan:'repair_saved_guard_then_stage_paused_bot'});
  assert.equal(p.writes.length,0);
  assert.equal(p.reads.length,5);
  assert.deepEqual({...f.c.db.prepare('SELECT state,guard_assistant_id,gateway_version,error_code FROM shared_voice_gateway WHERE id=1').get()},{...before});
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
 }finally{f.close()}
});
test('read-only repair preview refuses changed Voicebot or unsafe source template',async()=>{
 for(const mode of ['changedBot','unsafeTemplate']){
  const f=fixture();try{
   unknown(f);const p=provider({changedBot:mode==='changedBot',unsafeTemplate:mode==='unsafeTemplate'});
   const res=await handleVoiceGatewayRequest(previewReq(),f.env,admin,{now,fetcher:p.fetcher});
   assert.equal(res.status,200);
   const d=await res.json();
   assert.equal(d.eligible,false);
   assert.equal(d.reason,mode==='changedBot'?'shared_voicebot_version_or_traffic_changed':'saved_template_not_safe_for_guard_repair');
   assert.equal(d.plan,null);
   assert.equal(p.writes.length,0);
   assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
  }finally{f.close()}
 }
});

test('one confirmed repair reuses the same guard, stages only paused shared bot version and remains non-calling',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider();
  assert.equal((await handleVoiceGatewayRequest(req(),f.env,client,{now,fetcher:p.fetcher})).status,403);
  assert.equal((await handleVoiceGatewayRequest(req(),f.env,{...admin,token_hash:'bad'},{now,fetcher:p.fetcher})).status,403);
  assert.equal((await handleVoiceGatewayRequest(req('NOT_CONFIRMED'),f.env,admin,{now,fetcher:p.fetcher})).status,409);
  assert.equal(p.reads.length,0);assert.equal(p.writes.length,0);
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200,await res.clone().text());
  const data=await res.json();
  assert.equal(data.state,'staged');assert.equal(data.version,'v3');
  assert.match(data.notice,/0% traffic/);
  assert.equal(p.writes.length,2);assert.ok(p.writes[0].path.endsWith('/assistants/'+guard+'/versions'));
  assert.ok(p.writes[1].path.endsWith('/voicebots/'+bot+'/versions'));
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  assert.equal(f.c.db.prepare('SELECT state,gateway_version,error_code FROM shared_voice_gateway WHERE id=1').get().state,'staged');
  const saved=f.c.db.prepare('SELECT gateway_version,error_code FROM shared_voice_gateway WHERE id=1').get();
  assert.equal(saved.gateway_version,'v3');assert.equal(saved.error_code,'router_connection_required');
  assert.equal((await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher})).status,503);
  assert.equal(p.writes.length,2);
 }finally{f.close()}
});
test('already-verified guard skips rewriting assistant, stages paused bot once',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider({alreadySafe:true});
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200,await res.clone().text());
  assert.equal(p.writes.length,1);
  assert.ok(p.writes[0].path.endsWith('/voicebots/'+bot+'/versions'));
  assert.equal(p.writes[0].body.data.assistant_config.version,'v2');
 }finally{f.close()}
});
test('changed shared voicebot prevents all provider writes and DB unlock',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider({changedBot:true});
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,'gateway_provider_changed_stop');
  assert.equal(p.writes.length,0);
  assert.equal(f.c.db.prepare('SELECT state,error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'provider_write_unknown');
 }finally{f.close()}
});

const readRepairReq=()=>new Request('https://app.example.invalid/v1/human/voice-gateway',{
 method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},
 body:JSON.stringify({action:'repair-review'})});
test('uncertain Guard POST that never persisted can be reconciled without writing or unlocking',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider({failAfterGuardWrite:true});
  const failure=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(failure.status,503);
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_repair_unknown');
  const originalWrites=p.writes.length;
  const rejected=await handleVoiceGatewayRequest(readRepairReq(),f.env,client,{now,fetcher:p.fetcher});
  assert.equal(rejected.status,403);
  const res=await handleVoiceGatewayRequest(readRepairReq(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200,await res.clone().text());
  const body=await res.json();
  assert.equal(body.outcome,'guard_still_has_zero_agents');
  assert.equal(body.writeOperationsAllowed,false);
  assert.equal(body.guard.stable.agentCount,'zero');
  assert.equal(body.sharedVoicebot.unchangedAndPaused,true);
  assert.equal(p.writes.length,originalWrites);
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_repair_unknown');
 }finally{f.close()}
});
test('provider-saved Guard v3 after timeout is detected as verified, without staging or retrying',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider({failAfterGuardWrite:true,persistGuardBeforeFailure:true});
  const failure=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(failure.status,503);
  assert.equal(p.writes.length,1);
  const res=await handleVoiceGatewayRequest(readRepairReq(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.outcome,'saved_guard_verified_bot_not_staged');
  assert.equal(body.guard.stableVersion,'v3');
  assert.equal(body.guard.stable.agentCount,'one');
  assert.equal(body.guard.stable.strictGuardVerified,true);
  assert.equal(body.sharedVoicebot.unchangedAndPaused,true);
  assert.equal(body.writeOperationsAllowed,false);
  assert.equal(p.writes.length,1);
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_repair_unknown');
  assert.equal((await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher})).status,503);
  assert.equal(p.writes.length,1);
 }finally{f.close()}
});
test('repair review requires guard_repair_unknown and cannot read providers for other states',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider();
  const res=await handleVoiceGatewayRequest(readRepairReq(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,'guard_repair_review_requires_uncertain_state');
  assert.equal(p.writes.length,0);assert.equal(p.reads.length,0);
 }finally{f.close()}
});

test('ambiguous guard POST cannot be retried or stage an unsafe bot version',async()=>{
 const f=fixture();try{
  unknown(f);const p=provider({failAfterGuardWrite:true});
  const res=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,'gateway_recovery_write_unknown_stop');
  assert.equal(p.writes.length,1);
  assert.equal(f.c.db.prepare('SELECT state,error_code FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_repair_unknown');
  const retry=await handleVoiceGatewayRequest(req(),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(retry.status,503);assert.equal(p.writes.length,1);
 }finally{f.close()}
});
