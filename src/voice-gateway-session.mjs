import {verifyExotelWebhookToken,readBoundedExotelWebhook,isExplicitExotelWebhookProbe,isExactExotelDocumentationSample} from './exotel-voicebot-inbound.mjs';
import {checkExotelWebhookNetwork} from './exotel-webhook-network-guard.mjs';
import {readSharedGateway,registeredVoiceCallKey,verifySharedGatewayLive} from './shared-voice-gateway.mjs';
import {getExotelOperatorTestStatusReadOnly} from './exotel-readonly-verification.mjs';
import {resolveCrmDb} from './core.mjs';
const PATH='/v1/provider/exotel/voicebot/session-start',SID=/^[A-Za-z0-9_-]{4,128}$/;
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const ack=data=>json({http_code:200,response:{data}});
export async function handleVoiceGatewaySession(req,env,{now=Date.now(),apiFetch=fetch}={}){
 if(new URL(req.url).pathname!==PATH)return null;
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 if(req.headers.has('origin'))return json({error:'forbidden'},403);
 if(!await verifyExotelWebhookToken(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN,req.headers.get('authorization')))return json({error:'unauthorized'},401);
 const network=checkExotelWebhookNetwork(req,env);
 if(network.state==='invalid_allowlist')return json({error:'webhook_network_configuration_invalid'},503);
 if(network.state==='not_allowlisted')return json({error:'webhook_source_not_allowed'},403);
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'json_required'},415);
 try{
  const bytes=await readBoundedExotelWebhook(req);
  if(isExplicitExotelWebhookProbe(bytes)||isExactExotelDocumentationSample(bytes))return ack({});
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const runtime=await readSharedGateway(env),sid=body?.external_id;
  if(!runtime||!['staged','ready'].includes(runtime.state)||body?.bot_id!==runtime.bot_id||body.session_state!=='session_start'||(body.account_id&&body.account_id!==env.EXOTEL_ACCOUNT_SID)||typeof sid!=='string'||!SID.test(sid)||(body.metadata?.call_sid&&body.metadata.call_sid!==sid))return json({error:'session_identity_mismatch'},400);
  const route=await env.CONTROL_DB.prepare('SELECT * FROM voice_call_routes WHERE call_key=? AND expires_at>?').bind(await registeredVoiceCallKey(env,sid),new Date(now).toISOString()).first();
  if(!route)return json({error:'registered_call_route_required'},404);
  const tenant=await env.CONTROL_DB.prepare("SELECT id,storage_mode,dedicated_binding,status FROM tenants WHERE id=? AND status IN('trial','active')").bind(route.tenant_id).first();
  const publication=await env.CONTROL_DB.prepare("SELECT * FROM calling_agent_publications WHERE tenant_id=? AND id=? AND provider_state='ready'").bind(route.tenant_id,route.publication_id).first();
  if(!tenant||!publication?.provider_assistant_id||publication.provider_bot_id!==runtime.bot_id)return json({error:'registered_agent_unavailable'},409);
  let caller,destination;
  if(route.operator_request_id){
   const known=await env.CONTROL_DB.prepare("SELECT provider_call_sid FROM exotel_operator_test_calls WHERE id=? AND state='submitted'").bind(route.operator_request_id).first();
   if(known?.provider_call_sid!==sid)return json({error:'operator_call_reference_mismatch'},409);
   caller=env.EXOTEL_CALLER_ID;destination=env.EXOTEL_VERIFIED_TEST_NUMBER;
  }else{
   if(tenant.status!=='active')return json({error:'tenant_not_active'},409);
   const db=resolveCrmDb(env,tenant),job=await db.prepare("SELECT * FROM calling_jobs WHERE tenant_id=? AND id=? AND state='submitted'").bind(route.tenant_id,route.job_id).first();
   if(!job||job.provider_call_sid!==sid||job.account_sid!==env.EXOTEL_ACCOUNT_SID||job.flow_id!==runtime.flow_id)return json({error:'campaign_call_reference_mismatch'},409);
   caller=job.caller_id;destination=job.destination;
  }
  if(!/^\+91[6-9]\d{9}$/.test(destination||''))return json({error:'registered_destination_missing'},409);
  // Keep startup bounded: independent provider identity checks run concurrently
  // and share a 2.5-second budget. Nothing is dialled from this callback.
  const deadline=Date.now()+2500,limitedFetch=(url,options)=>apiFetch(url,{...options,signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
  const [,call]=await Promise.all([
   verifySharedGatewayLive(env,runtime,{fetcher:limitedFetch}),
   getExotelOperatorTestStatusReadOnly({accountSid:env.EXOTEL_ACCOUNT_SID,apiKey:env.EXOTEL_API_KEY,apiToken:env.EXOTEL_API_TOKEN,region:env.EXOTEL_REGION},{callSid:sid,callerId:caller,destination},{apiFetch:limitedFetch})
  ]);
  if(call.status!=='in-progress')return json({error:'registered_call_not_in_progress'},409);
  await env.CONTROL_DB.prepare("UPDATE shared_voice_gateway SET state='ready',last_verified_at=? WHERE id=1 AND bot_id=? AND gateway_version=? AND state IN('staged','ready')").bind(new Date(now).toISOString(),runtime.bot_id,runtime.gateway_version).run();
  return ack({conversation_assistant_id:publication.provider_assistant_id,greeting_message:{text:publication.greeting}});
 }catch{return json({error:'voice_session_routing_unconfirmed'},503)}
}
