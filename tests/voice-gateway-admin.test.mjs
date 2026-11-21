import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,now} from './helpers/calling-fixture.mjs';
import {handleVoiceGatewayRequest,KNOWN_SHARED_GATEWAY_BOOTSTRAP} from '../src/voice-gateway-routes.mjs';
const bot='44444444-4444-4444-8444-444444444444';
const req=(data,method='POST')=>new Request('https://app.example.invalid/v1/human/voice-gateway',{method,headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(data)}:{})});
test('gateway setup is current-MFA admin only and diagnostic reads expose structure, never secret values',async()=>{const f=fixture();try{
 let reads=0,writes=0;const fetcher=async(url,init)=>{if(init.method==='GET')reads++;else writes++;return Response.json({response:{id:bot,stable_version:'v1',webhook_config:{session_end:{url:'https://private.example.invalid/end',auth_config:{token:'never-print-this-token'}}},assistant_config:{id:'private-assistant',llm_config:{decrypted_auth_config:{api_key:'never-print-this-key'}}}}})};
 assert.equal((await handleVoiceGatewayRequest(req({action:'inspect',botId:bot}),f.env,client,{now,fetcher})).status,403);
 assert.equal((await handleVoiceGatewayRequest(req({action:'inspect',botId:bot}),f.env,{...admin,token_hash:'bad'},{now,fetcher})).status,403);
 assert.equal(reads,0);const r=await handleVoiceGatewayRequest(req({action:'inspect',botId:bot}),f.env,admin,{now,fetcher});assert.equal(r.status,200);const text=await r.text();assert.ok(text.includes('webhook_config'));assert.ok(!text.includes('never-print-this'));assert.ok(!text.includes('private.example'));assert.ok(!text.includes('private-assistant'));assert.equal(writes,0);assert.equal(reads,2);
 const suggested=await handleVoiceGatewayRequest(req({},'GET'),f.env,admin,{now});
 assert.equal(suggested.status,200);
 const data=await suggested.json();
 assert.equal(data.gateway,null);
 assert.deepEqual(data.suggestedGateway,KNOWN_SHARED_GATEWAY_BOOTSTRAP);
 assert.equal(data.flowTargetVerified,false);
 assert.equal((await handleVoiceGatewayRequest(req({},'GET'),f.env,client,{now})).status,403);
 assert.equal((await handleVoiceGatewayRequest(req({},'GET'),f.env,{...admin,token_hash:'bad'},{now})).status,403);
 const prep={action:'configure',...KNOWN_SHARED_GATEWAY_BOOTSTRAP};
 assert.equal((await handleVoiceGatewayRequest(req(prep),f.env,admin,{now,fetcher})).status,400);
 assert.equal((await handleVoiceGatewayRequest(req({...prep,flowTargetConfirmed:false}),f.env,admin,{now,fetcher})).status,409);
 assert.equal((await handleVoiceGatewayRequest(req({...prep,botId:bot,flowTargetConfirmed:true}),f.env,admin,{now,fetcher})).status,409);
 assert.equal(writes,0);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM shared_voice_gateway').get().n,0);
}finally{f.close()}});


test('uncertain Guard or bot write hard-blocks authenticated router connection before all provider reads and writes',async()=>{
 for(const error of ['provider_write_unknown','guard_repair_unknown','guard_agent_fix_unknown','bot_agent_fix_unknown']){
  const f=fixture();try{
   f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,gateway_version,state,error_code,updated_by,updated_at) VALUES(1,?,?,?,?,?,NULL,'unknown',?,'admin',?)")
    .run('66cbf4f6-a52d-4df0-abf0-db5e3b365836','1393135',
      '66666666-6666-4666-8666-666666666666','v1',
      '55555555-5555-4555-8555-555555555555',error,new Date(now).toISOString());
   let calls=0;
   const fetcher=async()=>{calls++;throw Error('must never touch Exotel');};
   const response=await handleVoiceGatewayRequest(req({
    action:'connect',authTemplateBotId:'c3c7ca7c-b06d-4b3d-b661-ef121f751021'
   }),f.env,admin,{now,fetcher});
   assert.equal(response.status,503);
   assert.equal((await response.json()).error,'shared_gateway_rollout_required');
   assert.equal(calls,0);
   assert.equal(f.c.db.prepare('SELECT state,error_code FROM shared_voice_gateway WHERE id=1').get().error_code,error);
   assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM voice_call_routes').get().n,0);
  }finally{f.close()}
 }
});
