import {voicebotRequest,unwrapVoicebot,createIsolatedPublishedAssistant} from './calling-script-provider.mjs';
export const GATEWAY_CALLBACK='https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/session-start';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const version=v=>typeof v==='string'&&/^v[1-9]\d{0,8}$/.test(v);
export async function readSharedGateway(env){return env.CONTROL_DB.prepare('SELECT * FROM shared_voice_gateway WHERE id=1').first()}
export async function verifySharedGatewayLive(env,runtime,{fetcher=fetch}={}){
 if(!runtime||!['staged','ready'].includes(runtime.state)||!uuid(runtime.bot_id)||!uuid(runtime.guard_assistant_id)||!version(runtime.gateway_version))throw Error('shared_gateway_setup_required');
 const path='/voicebots/'+runtime.bot_id,overview=unwrapVoicebot(await voicebotRequest(env,path,{fetcher}));
 if((overview.id||overview.bot_id)!==runtime.bot_id||overview.stable_version!==runtime.gateway_version||overview.traffic_allocation?.[runtime.gateway_version]!==100||Object.entries(overview.traffic_allocation||{}).some(([v,n])=>v!==runtime.gateway_version&&Number(n)>0))throw Error('shared_gateway_rollout_required');
 const bot=overview.latest_version===runtime.gateway_version||overview.version===runtime.gateway_version?overview:unwrapVoicebot(await voicebotRequest(env,path+'?version='+runtime.gateway_version,{fetcher}));
 if((bot.assistant_config?.id||bot.assistant_config?.assistant_id)!==runtime.guard_assistant_id)throw Error('shared_gateway_guard_mismatch');
 return true;
}
export async function registeredVoiceCallKey(env,callSid){
 if(!/^[0-9a-f]{64}$/i.test(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN||'')||!/^[A-Za-z0-9_-]{4,128}$/.test(callSid||''))throw Error('voice_route_configuration_required');
 const bytes=new TextEncoder(),key=await crypto.subtle.importKey('raw',bytes.encode(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hash=await crypto.subtle.sign('HMAC',key,bytes.encode('AR3D voice call route\n'+env.EXOTEL_ACCOUNT_SID+'\n'+callSid));
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function registerVoiceCall(env,{tenantId,publicationId,jobId=null,operatorRequestId=null,callSid,now=Date.now()}){
 const key=await registeredVoiceCallKey(env,callSid),at=new Date(now).toISOString(),expires=new Date(now+20*60000).toISOString();
 const r=await env.CONTROL_DB.prepare("INSERT INTO voice_call_routes(call_key,tenant_id,publication_id,job_id,operator_request_id,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM calling_agent_publications WHERE tenant_id=? AND id=? AND provider_state='ready')").bind(key,tenantId,publicationId,jobId,operatorRequestId,at,expires,tenantId,publicationId).run();
 if(r.meta.changes!==1)throw Error('voice_call_route_unconfirmed');
}
function shape(v,depth=0,budget={n:0}){if(budget.n++>180)return 'truncated';if(!v||typeof v!=='object')return typeof v;if(depth>3)return 'object';if(Array.isArray(v))return v.slice(0,3).map(x=>shape(x,depth+1,budget));return Object.fromEntries(Object.entries(v).slice(0,50).map(([k,x])=>[k,shape(x,depth+1,budget)]))}
export async function inspectGatewayConfiguration(env,botId,{fetcher=fetch}={}){
 if(!uuid(botId))throw Error('invalid_bot');
 const modern=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId,{fetcher}));
 let assistantShape=null;const assistantId=modern.assistant_config?.id||modern.assistant_config?.assistant_id,sourceVersion=modern.assistant_config?.version||modern.assistant_config?.assistant_version;
 if(uuid(assistantId)){try{assistantShape=shape(unwrapVoicebot(await voicebotRequest(env,'/assistants/'+assistantId+(version(sourceVersion)?'?version='+sourceVersion:''),{fetcher})))}catch{assistantShape='unavailable'}}
 let legacy;try{legacy=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId,{fetcher,apiVersion:'v1'}))}catch{return {botId,assistantShape,modernKeys:Object.keys(modern||{}),modernShape:shape(modern),legacyAvailable:false}}
 return {botId,assistantShape,modernKeys:Object.keys(modern||{}),modernShape:shape(modern),legacyAvailable:true,legacyKeys:Object.keys(legacy||{}),legacyShape:shape(legacy)};
}
// The runtime is configured once. Every client publication then creates only an
// isolated assistant; no per-client Exotel bot, phone number or flow is required.
export async function prepareSharedGateway(env,{botId,flowId,authTemplateBotId,actorId,now=Date.now()},{fetcher=fetch}={}){
 if(!uuid(botId)||!uuid(authTemplateBotId)||!(/^[1-9]\d{0,11}$/.test(flowId||'')))throw Error('invalid_gateway_configuration');
 const db=env.CONTROL_DB,existing=await readSharedGateway(env);
 if(existing)throw Error('gateway_already_configured_review_existing_setup');
 const options={fetcher},overview=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId,options));
 const stable=overview.stable_version;
 if((overview.id||overview.bot_id)!==botId||!version(stable))throw Error('invalid_provider_bot');
 const bot=overview.latest_version===stable||overview.version===stable?overview:unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId+'?version='+stable,options));
 const templateId=bot.assistant_config?.id||bot.assistant_config?.assistant_id;
 let templateVersion=bot.assistant_config?.version||bot.assistant_config?.assistant_version;
 if(!uuid(templateId))throw Error('invalid_template_assistant');
 if(!version(templateVersion)){const a=unwrapVoicebot(await voicebotRequest(env,'/assistants/'+templateId,options));templateVersion=a.stable_version;if(!version(templateVersion))throw Error('invalid_template_version')}
 // Official MCP legacy Bot Configuration API includes hook configuration. Copy
 // only the already-owned authenticated hook contract; never expose its values.
 const authBot=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+authTemplateBotId,{...options,apiVersion:'v1'}));
 const hooks=authBot.webhook_config;
 if(!hooks||Array.isArray(hooks)||!hooks.session_end||typeof hooks.session_end.url!=='string')throw Error('webhook_template_contract_unverified');
 const hook=structuredClone(hooks.session_end);hook.url=GATEWAY_CALLBACK;
 const at=new Date(now).toISOString();
 await db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,state,updated_by,updated_at) VALUES(1,?,?,?,?,'configuring',?,?)").bind(botId,flowId,templateId,templateVersion,actorId,at).run();
 try{
  const runtime={template_assistant_id:templateId,template_version:templateVersion};
  const guard=await createIsolatedPublishedAssistant(env,runtime,'You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.','Routing guard',{fetcher,onCreated:async id=>{await db.prepare('UPDATE shared_voice_gateway SET guard_assistant_id=? WHERE id=1').bind(id).run()}});
  const assistant_config={...bot.assistant_config,id:guard.assistantId,version:null};delete assistant_config.assistant_id;delete assistant_config.assistant_version;
  const result=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId+'/versions',{...options,method:'POST',body:{source_version:stable,version_description:'AR3D shared multi-client gateway: authenticated session router and isolated fallback',data:{assistant_config,webhook_config:{...hooks,session_start:hook}}}}));
  const v=result.version||result.latest_version;if(!version(v))throw Error();
  await db.prepare("UPDATE shared_voice_gateway SET state='staged',gateway_version=?,updated_at=? WHERE id=1 AND state='configuring'").bind(v,at).run();
  return {version:v,state:'staged',notice:'Shared gateway prepared. Roll this version out once; subsequent client creation and publication require no Exotel dashboard work.'};
 }catch{await db.prepare("UPDATE shared_voice_gateway SET state='unknown',error_code='provider_write_unknown',updated_at=? WHERE id=1").bind(at).run();throw Error('gateway_setup_unknown_review_before_retry')}
}
