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
  let reads=0,writes=0;
  const fetcher=async(url,init)=>{
   assert.equal(new URL(url).hostname,'voicebot.in.exotel.com');
   if(init.method!=='GET')writes++;
   reads++;
   const u=new URL(url),v=u.searchParams.get('version');
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
  assert.equal(d.gatewayVersionRecorded,null);
  assert.equal(d.latestVersion,'v3');assert.equal(d.stableVersion,'v2');
  assert.equal(d.providerReadable,true);
  assert.equal(d.latestVersionUsesRecordedGuard,true);
  assert.equal(d.stableVersionUsesRecordedGuard,false);
  assert.match(d.recommendation,/Never retry Prepare/);
  assert.equal(reads,3);assert.equal(writes,0);
  const after=f.c.db.prepare('SELECT state,guard_assistant_id,gateway_version,error_code FROM shared_voice_gateway WHERE id=1').get();
  assert.deepEqual({...after},{state:'unknown',guard_assistant_id:guard,gateway_version:null,error_code:'provider_write_unknown'});
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
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
