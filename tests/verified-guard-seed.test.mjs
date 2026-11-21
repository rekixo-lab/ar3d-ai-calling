import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,now} from './helpers/calling-fixture.mjs';
import {createVerifiedRoutingGuard} from '../src/calling-script-provider.mjs';
import {prepareSharedGateway} from '../src/shared-voice-gateway.mjs';

const bot='66cbf4f6-a52d-4df0-abf0-db5e3b365836';
const template='55555555-5555-4555-8555-555555555555';
const guard='66666666-6666-4666-8666-666666666666';
const auth='c3c7ca7c-b06d-4b3d-b661-ef121f751021';
const prompt='You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.';
const runtime={template_assistant_id:template,template_version:'v1'};

function provider({seedMissing=false,sourceTools=false,unstableSeed=false,seedWrongModel=false,failBotCandidate=false}={}){
 let created=false,version='v1',stable=unstableSeed?null:'v1';
 let botLatest='v2',botStable='v2',traffic={v2:100};
 const writes=[],reads=[];
 const fetcher=async(url,init)=>{
  const u=new URL(url),path=u.pathname,v=u.searchParams.get('version'),method=init.method;
  assert.equal(u.hostname,'voicebot.in.exotel.com');
  if(method==='POST'){
   const body=JSON.parse(init.body);writes.push({path,body});
   assert.ok(!path.endsWith('/calls'));
   if(path.endsWith('/assistants')){
    assert.equal(body.agents.length,1);
    assert.equal(body.agents[0].instruction,prompt);
    assert.equal(body.instruction,prompt);
    assert.equal(body.agents[0].id,undefined);
    assert.equal(body.agents[0].llm_config.model_id,'safe-source-model');
    assert.ok(!JSON.stringify(body).includes('PRIVATE_AJAY_PROMPT'));
    created=true;return Response.json({response:{id:guard,latest_version:'v1'}});
   }
   if(path.endsWith('/assistants/'+guard+'/versions')){
    assert.equal(created,true);
    assert.equal(seedMissing,false,'MUST NOT push from an Agent-less seed');
    assert.equal(body.source_version,'v1');
    assert.equal(body.mark_as_stable,'true');
    assert.equal(body.data.agents.length,1);
    assert.equal(body.data.agents[0].id,'provider-assigned-id');
    version='v2';stable='v2';
    return Response.json({response:{version:'v2'}});
   }
   if(path.endsWith('/voicebots/'+bot+'/versions')){
    assert.equal(body.mark_as_stable,'false');
    assert.equal(body.source_version,'v2');
    assert.equal(body.data.assistant_config.id,guard);
    assert.equal(body.data.assistant_config.version,unstableSeed?'v2':'v1');
    botLatest='v3';traffic=failBotCandidate?{v2:90,v3:10}:{v2:100,v3:0};
    return Response.json({response:{version:'v3'}});
   }
   throw Error('unexpected POST '+path);
  }
  assert.equal(method,'GET');reads.push(path+u.search);
  if(path.endsWith('/assistants/'+template))return Response.json({response:{
   id:template,version:'v1',latest_version:'v1',stable_version:'v1',
   instruction:'PRIVATE_AJAY_PROMPT',llm_config:{model_id:'safe-source-model'},
   agents:[{id:'private-template-agent',instruction:'PRIVATE_AJAY_PROMPT',tools:sourceTools?['unsafe']:[],
    llm_config:{model_id:'safe-source-model'}}]
  }});
  if(path.endsWith('/assistants/'+guard)){
   assert.equal(created,true);
   if(v)return Response.json({response:{
    id:guard,version:v,latest_version:version,stable_version:stable,
    instruction:prompt,agents:seedMissing?[]:[{id:'provider-assigned-id',instruction:prompt,
     llm_config:{model_id:seedWrongModel?'wrong':'safe-source-model'},tools:[],mcp_tools:[]}]
   }});
   return Response.json({response:{id:guard,latest_version:version,stable_version:stable}});
  }
  if(path.endsWith('/voicebots/'+auth))return Response.json({response:{
   id:auth,webhook_config:{session_end:{url:'https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/session-end'}}
  }});
  if(path.endsWith('/voicebots/'+bot)){
   if(v==='v3')return Response.json({response:{
    id:bot,version:'v3',assistant_config:{id:guard,version:unstableSeed?'v2':'v1'}
   }});
   if(v==='v2')return Response.json({response:{id:bot,version:'v2',assistant_config:{id:template,version:'v1'}}});
   return Response.json({response:{id:bot,stable_version:botStable,latest_version:botLatest,
    assistant_config:{id:template,version:'v1'},traffic_allocation:traffic}});
  }
  throw Error('unexpected GET '+path);
 };
 return {fetcher,writes,reads};
}
test('initial create with verified stable seed Agent skips unnecessary version write',async()=>{
 const f=fixture();try{
  const p=provider();const ids=[];
  const d=await createVerifiedRoutingGuard(f.env,runtime,prompt,{fetcher:p.fetcher,onCreated:id=>{ids.push(id)}});
  assert.deepEqual(d,{assistantId:guard,version:'v1'});
  assert.deepEqual(ids,[guard]);
  assert.equal(p.writes.length,1);
  assert.ok(p.reads.some(s=>s.includes('/assistants/'+guard+'?version=v1')));
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
 }finally{f.close()}
});
test('Agent missing from initial create stops before creating ANY versions',async()=>{
 const f=fixture();try{
  const p=provider({seedMissing:true});const ids=[];
  await assert.rejects(createVerifiedRoutingGuard(f.env,runtime,prompt,{
   fetcher:p.fetcher,onCreated:id=>{ids.push(id)}
  }),/provider_write_unknown/);
  assert.deepEqual(ids,[guard]);
  assert.equal(p.writes.length,1);
  assert.ok(p.writes[0].path.endsWith('/assistants'));
 }finally{f.close()}
});
test('only an already verified seed can be used for a later stable version write',async()=>{
 const f=fixture();try{
  const p=provider({unstableSeed:true});
  const d=await createVerifiedRoutingGuard(f.env,runtime,prompt,{fetcher:p.fetcher});
  assert.deepEqual(d,{assistantId:guard,version:'v2'});
  assert.equal(p.writes.length,2);
  assert.ok(p.writes[1].path.endsWith('/assistants/'+guard+'/versions'));
 }finally{f.close()}
});
test('unsafe source tools or model mismatch abort before any version write',async()=>{
 for(const opts of [{sourceTools:true},{seedWrongModel:true}]){
  const f=fixture();try{
   const p=provider(opts);
   await assert.rejects(createVerifiedRoutingGuard(f.env,runtime,prompt,{fetcher:p.fetcher}),
    opts.sourceTools?/guard_seed_template_unverified/:/provider_write_unknown/);
   assert.equal(p.writes.length,opts.sourceTools?0:1);
  }finally{f.close()}
 }
});
test('new Gateway setup stages a paused 0%-traffic candidate only after verifying seed Agent',async()=>{
 const f=fixture();try{
  const p=provider();
  const d=await prepareSharedGateway(f.env,{botId:bot,flowId:'1393135',authTemplateBotId:auth,actorId:'admin',now},{fetcher:p.fetcher});
  assert.equal(d.state,'staged');
  assert.equal(d.version,'v3');
  assert.equal(p.writes.length,2);
  assert.equal(p.writes[0].path.includes('/assistants'),true);
  assert.equal(p.writes[1].path.includes('/voicebots'),true);
  assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'staged');
  assert.equal(f.c.db.prepare('SELECT gateway_version FROM shared_voice_gateway WHERE id=1').get().gateway_version,'v3');
 }finally{f.close()}
});
test('bad 0% bot rollout or missing seed Agent never marks Gateway staged and blocks retry',async()=>{
 for(const scenario of [{failBotCandidate:true},{seedMissing:true}]){
  const f=fixture();try{
   const p=provider(scenario);
   await assert.rejects(prepareSharedGateway(f.env,{botId:bot,flowId:'1393135',authTemplateBotId:auth,actorId:'admin',now},{
    fetcher:p.fetcher
   }),/gateway_setup_unknown_review_before_retry/);
   assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway WHERE id=1').get().state,'unknown');
   assert.equal(f.c.db.prepare('SELECT error_code FROM shared_voice_gateway WHERE id=1').get().error_code,'provider_write_unknown');
   assert.equal(p.writes.length,scenario.seedMissing?1:2);
  }finally{f.close()}
 }
});
