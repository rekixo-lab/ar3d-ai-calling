import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {handleVoiceGatewayRequest} from '../src/voice-gateway-routes.mjs';

const bot='66cbf4f6-a52d-4df0-abf0-db5e3b365836';
const guard='55555555-5555-4555-8555-555555555555';
const template='66666666-6666-4666-8666-666666666666';
const prompt='You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.';
const action=(name,confirmation)=>new Request('https://app.example.invalid/v1/human/voice-gateway',{
 method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},
 body:JSON.stringify({action:name,...(confirmation?{confirmation}:{})})});
function seed(f){
 f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,gateway_version,state,error_code,updated_by,updated_at) VALUES(1,?,?,?,?,?,NULL,'unknown','guard_repair_unknown','admin',?)")
 .run(bot,'1393135',template,'v1',guard,at);
}
function provider({dropSavedAgent=false,changedBot=false,sourceUnsafe=false,sourceNoModel=false}={}){
 let guardStable='v3',botLatest=changedBot?'v3':'v2',writtenAgent=null,writes=[],reads=[];
 const fetcher=async(url,init)=>{
  const p=new URL(url),path=p.pathname,v=p.searchParams.get('version');
  assert.equal(p.hostname,'voicebot.in.exotel.com');
  if(init.method==='POST'){
   const data=JSON.parse(init.body);writes.push({path,body:data});
   assert.ok(!path.endsWith('/calls'));assert.ok(!path.includes('c3c7ca7c'));
   if(path.endsWith('/assistants/'+guard+'/versions')){
    assert.equal(data.source_version,'v3');
    assert.equal(data.mark_as_stable,'true');
    assert.deepEqual(Object.keys(data.data),['agents']);
    assert.equal(data.data.agents.length,1);
    assert.equal(data.data.agents[0].id,undefined);
    assert.equal(data.data.agents[0].tools,undefined);
    assert.equal(data.data.agents[0].instruction,prompt);
    assert.equal(data.data.agents[0].llm_config.model_id,'working-model');
    assert.ok(!JSON.stringify(data).includes('PRIVATE_CLIENT_SCRIPT'));
    guardStable='v4';writtenAgent=dropSavedAgent?null:data.data.agents[0];
    return Response.json({response:{version:'v4'}});
   }
   if(path.endsWith('/voicebots/'+bot+'/versions')){
    assert.equal(data.mark_as_stable,'false');
    assert.equal(data.source_version,'v2');
    assert.equal(data.data.assistant_config.id,guard);
    assert.equal(data.data.assistant_config.version,'v4');
    botLatest='v3';return Response.json({response:{version:'v3'}});
   }
   throw Error('unexpected write');
  }
  assert.equal(init.method,'GET');reads.push(path+p.search);
  if(path.endsWith('/assistants/'+template)&&v==='v1')return Response.json({response:{
   id:template,version:'v1',stable_version:'v1',latest_version:'v1',
   llm_config:{model_id:'working-model'},
   agents:sourceUnsafe?[]:[{id:template,description:'private',instruction:'PRIVATE_CLIENT_SCRIPT',
    ...(sourceNoModel?{}:{llm_config:{model_id:'working-model'}}),tools:[],mcp_tools:[]}]
  }});
  if(path.endsWith('/assistants/'+guard)){
   if(v==='stable'||v==='v3'||v==='v4')return Response.json({response:{
    id:guard,version:v==='stable'?guardStable:v,stable_version:guardStable,latest_version:guardStable,
    instruction:prompt,agents:(v==='v4'||v==='stable')&&guardStable==='v4'&&writtenAgent?[writtenAgent]:[]
   }});
   return Response.json({response:{id:guard,stable_version:guardStable,latest_version:guardStable,
    versions:{[guardStable]:{agents:writtenAgent?[writtenAgent]:[]}}}});
  }
  if(path.endsWith('/voicebots/'+bot)){
   if(v==='v2')return Response.json({response:{id:bot,version:'v2',assistant_config:{id:template,version:'v1'}}});
   if(v==='v3')return Response.json({response:{id:bot,version:'v3',assistant_config:{id:guard,version:'v4'}}});
   return Response.json({response:{id:bot,stable_version:'v2',latest_version:botLatest,
    traffic_allocation:botLatest==='v3'?{v2:100,v3:0}:{v2:100}}});
  }
  throw Error('unexpected GET '+path);
 };
 return {fetcher,reads,writes};
}

test('agent-only preview verifies zero-Agent v3 and source model without any Exotel or D1 write',async()=>{
 const f=fixture();try{
  seed(f);const p=provider();
  assert.equal((await handleVoiceGatewayRequest(action('agent-only-preview'),f.env,client,{now,fetcher:p.fetcher})).status,403);
  const r=await handleVoiceGatewayRequest(action('agent-only-preview'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.eligible,true);
  assert.equal(d.sourceGuardVersion,'v3');
  assert.equal(d.sharedBotVersion,'v2');
  assert.equal(d.noCalls,true);
  assert.equal(d.noTrafficChange,true);
  assert.equal(p.writes.length,0);
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_repair_unknown');
 }finally{f.close()}
});
test('confirmed one-shot agent-only payload repairs Guard, verifies model, then stages only 0% candidate',async()=>{
 const f=fixture();try{
  seed(f);const p=provider();
  assert.equal((await handleVoiceGatewayRequest(action('agent-only-fix'),f.env,client,{now,fetcher:p.fetcher})).status,403);
  const unconfirmed=await handleVoiceGatewayRequest(action('agent-only-fix','wrong'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(unconfirmed.status,409);
  assert.equal(p.writes.length,0);
  const r=await handleVoiceGatewayRequest(action('agent-only-fix','CREATE_ONE_AGENT_ONLY_GUARD_VERSION_PAUSED_NO_CALLS'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(r.status,200,await r.clone().text());
  const d=await r.json();
  assert.equal(d.state,'staged');
  assert.equal(d.guardVersion,'v4');
  assert.equal(d.version,'v3');
  assert.equal(p.writes.length,2);
  assert.ok(p.writes[0].path.endsWith('/assistants/'+guard+'/versions'));
  assert.ok(p.writes[1].path.endsWith('/voicebots/'+bot+'/versions'));
  assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'staged');
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'router_connection_required');
  assert.equal(f.c.db.prepare('SELECT gateway_version FROM shared_voice_gateway WHERE id=1').get().gateway_version,'v3');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  const second=await handleVoiceGatewayRequest(action('agent-only-fix','CREATE_ONE_AGENT_ONLY_GUARD_VERSION_PAUSED_NO_CALLS'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(second.status,503);assert.equal(p.writes.length,2);
 }finally{f.close()}
});
test('if provider acknowledges v4 but drops the Agent again, stop with permanent lock and do not create a Bot version',async()=>{
 const f=fixture();try{
  seed(f);const p=provider({dropSavedAgent:true});
  const r=await handleVoiceGatewayRequest(action('agent-only-fix','CREATE_ONE_AGENT_ONLY_GUARD_VERSION_PAUSED_NO_CALLS'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'guard_agent_only_fix_unknown_stop');
  assert.equal(p.writes.length,1);
  assert.ok(p.writes[0].path.endsWith('/assistants/'+guard+'/versions'));
  assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
  assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_agent_fix_unknown');
  const next=await handleVoiceGatewayRequest(action('agent-only-fix','CREATE_ONE_AGENT_ONLY_GUARD_VERSION_PAUSED_NO_CALLS'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(next.status,503);assert.equal(p.writes.length,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  const read=await handleVoiceGatewayRequest(action('repair-review'),f.env,admin,{now,fetcher:p.fetcher});
  assert.equal(read.status,200);
  assert.equal((await read.json()).writeOperationsAllowed,false);
 }finally{f.close()}
});
test('changed Shared Voicebot or unsafe source aborts all provider writes',async()=>{
 for(const opts of [{changedBot:true},{sourceUnsafe:true}]){
  const f=fixture();try{
   seed(f);const p=provider(opts);
   const r=await handleVoiceGatewayRequest(action('agent-only-fix','CREATE_ONE_AGENT_ONLY_GUARD_VERSION_PAUSED_NO_CALLS'),f.env,admin,{now,fetcher:p.fetcher});
   assert.equal(r.status,503);
   assert.equal((await r.json()).error,'guard_agent_only_fix_preflight_blocked');
   assert.equal(p.writes.length,0);
   assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'guard_repair_unknown');
  }finally{f.close()}
 }
});
