import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,now} from './helpers/calling-fixture.mjs';
import {setupPublication,gatewayBot,guardAssistant} from './helpers/publication-fixture.mjs';
import {cloneOwnedWebhook,connectSharedGatewayRouter,GATEWAY_CALLBACK} from '../src/shared-voice-gateway.mjs';
const authBot='88888888-8888-4888-8888-888888888888',secret='a'.repeat(64);
function hook(event){return {trigger_mode:'sequential',actions:[{type:'http_request',request:{url:'https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/'+event,auth:{type:'bearer',token:secret},timeout_sec:3,retry_config:{max_retry:0}}}]}}
test('legacy hook action cloning preserves authentication and copies only the owned endpoint',()=>{
 const original=hook('session-end');original.actions.push({type:'http_request',request:{url:'https://unrelated.invalid/private'}});
 const result=cloneOwnedWebhook(original,'session-end',GATEWAY_CALLBACK);assert.equal(result.actions.length,1);assert.equal(result.actions[0].request.url,GATEWAY_CALLBACK);assert.equal(result.actions[0].request.auth.token,secret);assert.equal(result.trigger_mode,'sequential');assert.equal(original.actions[0].request.url,'https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/session-end');
 assert.throws(()=>cloneOwnedWebhook({actions:[{url:'https://other.invalid'}]},'session-end',GATEWAY_CALLBACK),/contract_unverified/);
});
test('one-time router uses official V1 full-config PUT and preserves speech and enforces the two-minute gateway test limit',async()=>{const f=fixture();try{await setupPublication(f);f.c.db.prepare("UPDATE shared_voice_gateway SET state='staged',error_code='router_connection_required'").run();
 let current={id:gatewayBot,version:'v2',assistant_config:{id:guardAssistant,version:null},voice_config:{voice:'Anika'},asr_config:{model:'Nova3'},enable_call_threshold:false,call_duration_threshold_sec:0,webhook_config:{}};let writes=0;
 const fetcher=async(url,options)=>{
  if(url.includes(authBot))return Response.json({response:{data:{webhook_config:{session_end:hook('session-end'),transcript_events:hook('transcript-events')}}}});
  if(url.includes('/api/v1/')){
   if(options.method==='PUT'){writes++;const body=JSON.parse(options.body);assert.deepEqual(body.voice_config,current.voice_config);assert.deepEqual(body.asr_config,current.asr_config);assert.equal(body.call_duration_threshold_sec,120);assert.equal(body.assistant_config.id,guardAssistant);current=body}
   return Response.json({response:{data:current}});
  }
  return Response.json({response:{id:gatewayBot,stable_version:'v2',traffic_allocation:{v2:100}}});
 };
 const result=await connectSharedGatewayRouter(f.env,{authTemplateBotId:authBot,actorId:admin.id,now},{fetcher});assert.equal(result.state,'staged');assert.equal(writes,1);assert.equal(current.webhook_config.session_start.actions[0].request.url,GATEWAY_CALLBACK);assert.ok(!JSON.stringify(result).includes(secret));
 const runtime=f.c.db.prepare('SELECT * FROM shared_voice_gateway').get();assert.equal(runtime.error_code,null);assert.equal(runtime.state,'staged');
}finally{f.close()}});
test('ambiguous router write keeps the gateway blocked and never prints provider errors',async()=>{const f=fixture();try{await setupPublication(f);f.c.db.prepare("UPDATE shared_voice_gateway SET state='staged'").run();
 const fetcher=async(url,options)=>{
  if(options.method==='PUT')throw Error('private-provider-token');
  if(url.includes(authBot))return Response.json({response:{data:{webhook_config:{session_end:hook('session-end'),transcript_events:hook('transcript-events')}}}});
  if(url.includes('/api/v1/'))return Response.json({response:{data:{assistant_config:{id:guardAssistant},webhook_config:{}}}});
  return Response.json({response:{stable_version:'v2',traffic_allocation:{v2:100}}});
 };
 await assert.rejects(connectSharedGatewayRouter(f.env,{authTemplateBotId:authBot,actorId:admin.id,now},{fetcher}),/gateway_router_write_unknown/);
 assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway').get().state,'unknown');
}finally{f.close()}});
