import {voicebotRequest,unwrapVoicebot,assistantVersionConfig,createIsolatedPublishedAssistant} from './calling-script-provider.mjs';
export const GATEWAY_CALLBACK='https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/session-start';
const GUARD_PROMPT='You are the AR3D call routing guard. Client context is unavailable. Say in Hindi that the connection could not be loaded and politely end. Do not discuss company, project, pricing or customer information. Never ask survey questions.';
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
// Review a previously uncertain provider write without mutating Exotel or D1.
// Never infer that a candidate version is safe to roll out or that calls are ready.
// Return only IDs/version numbers and comparisons; never serialize credentials,
// webhook settings, full assistant content, personal data or provider payloads.
export async function reviewUnknownGateway(env,runtime,{fetcher=fetch}={}){
 if(!runtime||runtime.state!=='unknown'||!uuid(runtime.bot_id))
  throw Error('gateway_review_requires_unknown_state');
 const savedGuard=uuid(runtime.guard_assistant_id)?runtime.guard_assistant_id:null;
 const savedVersion=version(runtime.gateway_version)?runtime.gateway_version:null;
 const output={
  savedState:'unknown',errorCode:'provider_write_unknown',
  guardAssistantRecorded:Boolean(savedGuard),gatewayVersionRecorded:savedVersion,
  providerReadable:false,latestVersion:null,stableVersion:null,
  latestVersionUsesRecordedGuard:null,stableVersionUsesRecordedGuard:null,
  guardAssistantReadable:null,guardAssistantStableVersion:null,
  guardAssistantFinalized:null,guardAssistantReadError:null,guardVersionContract:null,
  recommendation:'Stop. Review the actual Exotel Voicebot versions and account state before any provider update, rollout or call. Never retry Prepare.'
 };
 // A guard ID is written to D1 immediately after provider creation, before
 // its version is finalized. Read only the NEW guard to locate the failure.
 if(savedGuard){
  try{
   const base=unwrapVoicebot(await voicebotRequest(env,'/assistants/'+savedGuard,{fetcher}));
   if((base?.id||base?.assistant_id)!==savedGuard){
    output.guardAssistantReadable=false;
    output.guardAssistantReadError='guard_identity_mismatch';
   }else{
    output.guardAssistantReadable=true;
    const stable=version(base.stable_version)?base.stable_version:null;
    output.guardAssistantStableVersion=stable;
    if(stable){
     try{
      const saved=unwrapVoicebot(await voicebotRequest(env,'/assistants/'+savedGuard+'?version='+stable,{fetcher}));
      if((saved?.id||saved?.assistant_id)!==savedGuard)
       output.guardAssistantReadError='guard_version_identity_mismatch';
      else{
       // Exotel can return the requested version with root-level fields
       // while preserving a separate latest_version. Return fixed boolean
       // presence indicators only, never names, instructions, IDs or payload.
       output.guardVersionContract={
        responseHasRootAgents:Array.isArray(saved.agents),
        responseHasVersionedAgents:Array.isArray(saved.versions?.[stable]?.agents),
        responseHasAssistantConfigAgents:Array.isArray(saved.assistant_config?.agents),
        responseHasRootVersionTag:version(saved.version),
        responseVersionMatchesRequested:saved.version===stable,
        responseLatestMatchesRequested:saved.latest_version===stable,
        responseStableMatchesRequested:saved.stable_version===stable
       };
       const config=assistantVersionConfig(saved,stable);
       const count=agents=>!Array.isArray(agents)?'absent':agents.length===0?'zero':agents.length===1?'one':'multiple';
       // Safe classifications only: never expose agent contents, instructions or credentials.
       output.guardVersionContract.responseRootAgentCount=count(saved.agents);
       output.guardVersionContract.responseSelectedAgentCount=count(config?.agents);
       output.guardVersionContract.rootInstructionMatchesGuard=typeof config?.instruction==='string'?config.instruction===GUARD_PROMPT:null;
       output.guardVersionContract.agentInstructionMatchesGuard=config?.agents?.length===1?config.agents[0]?.instruction===GUARD_PROMPT:null;
       if(config?.agents?.length===1){
        // Exact prompt verification happens server-side; never return the
        // instructions, assistant/agent config, models or credentials.
        output.guardAssistantFinalized=validRoutingGuard(saved,savedGuard,stable);
       }else output.guardAssistantReadError='guard_version_not_confirmed';
      }
     }catch{output.guardAssistantReadError='guard_version_read_unavailable'}
    }
   }
  }catch{output.guardAssistantReadable=false;output.guardAssistantReadError='guard_read_unavailable'}
 }
 try{
  const path='/voicebots/'+runtime.bot_id;
  const current=unwrapVoicebot(await voicebotRequest(env,path,{fetcher}));
  if((current.id||current.bot_id)!==runtime.bot_id)
   return {...output,providerError:'provider_bot_identity_mismatch'};
  const latest=version(current.latest_version)?current.latest_version:null;
  const stable=version(current.stable_version)?current.stable_version:null;
  const result={...output,providerReadable:true,latestVersion:latest,stableVersion:stable};
  if(!savedGuard)return result;
  const examine=async v=>{
   if(!v)return null;
   try{
    const data=unwrapVoicebot(await voicebotRequest(env,path+'?version='+v,{fetcher}));
    if((data.id||data.bot_id)!==runtime.bot_id)return null;
    return (data.assistant_config?.id||data.assistant_config?.assistant_id)===savedGuard;
   }catch{return null}
  };
  result.latestVersionUsesRecordedGuard=await examine(latest);
  result.stableVersionUsesRecordedGuard=stable===latest?
   result.latestVersionUsesRecordedGuard:await examine(stable);
  return result;
 }catch(e){
  const safe=/^[a-z0-9_]{1,80}$/.test(e?.message||'')?e.message:'provider_review_unavailable';
  return {...output,providerError:safe};
 }
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
export function cloneOwnedWebhook(source,eventName,target){
 const expected='https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/'+eventName;
 let replaced=0;
 function rewrite(value){
  if(typeof value==='string'){try{const u=new URL(value);if(u.origin==='https://aicalling.ar3dstudio.in'&&u.pathname.replace(/\/$/,'')===new URL(expected).pathname){replaced++;return target}}catch{}return value}
  if(Array.isArray(value))return value.map(rewrite);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,rewrite(v)]));
  return value;
 }
 if(!source||typeof source!=='object'||Array.isArray(source))throw Error('webhook_template_contract_unverified');
 let selected=source;
 if(Array.isArray(source.actions)){
  const matches=source.actions.filter(action=>{let found=false;function scan(v){if(typeof v==='string'){try{const u=new URL(v);if(u.origin==='https://aicalling.ar3dstudio.in'&&u.pathname.replace(/\/$/,'')===new URL(expected).pathname)found=true}catch{}}else if(v&&typeof v==='object')Object.values(v).forEach(scan)}scan(action);return found});
  if(matches.length!==1)throw Error('webhook_template_contract_unverified');selected={...source,actions:matches};
 }
 const copy=rewrite(selected);if(replaced!==1)throw Error('webhook_template_contract_unverified');return copy;
}
function webhookTimers(value){const out=[];function visit(v,path=[]){if(out.length>=24)return;if(typeof v==='number'&&Number.isFinite(v)&&/(timeout|retry|interval)/i.test(path.join('.')))out.push({path:path.join('.'),value:v});else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))visit(x,[...path,k])}visit(value);return out}
export async function inspectGatewayConfiguration(env,botId,{fetcher=fetch}={}){
 if(!uuid(botId))throw Error('invalid_bot');
 const modern=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId,{fetcher}));
 let assistantShape=null;const assistantId=modern.assistant_config?.id||modern.assistant_config?.assistant_id,sourceVersion=modern.assistant_config?.version||modern.assistant_config?.assistant_version;
 if(uuid(assistantId)){try{assistantShape=shape(unwrapVoicebot(await voicebotRequest(env,'/assistants/'+assistantId+(version(sourceVersion)?'?version='+sourceVersion:''),{fetcher})))}catch{assistantShape='unavailable'}}
 let legacy;try{legacy=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId,{fetcher,apiVersion:'v1'}))}catch{return {botId,assistantShape,modernKeys:Object.keys(modern||{}),modernShape:shape(modern),legacyAvailable:false}}
 return {botId,assistantShape,modernKeys:Object.keys(modern||{}),modernShape:shape(modern),legacyAvailable:true,legacyKeys:Object.keys(legacy||{}),legacyShape:shape(legacy),callDurationLimit:{enabled:legacy.enable_call_threshold===true,seconds:Number.isInteger(legacy.call_duration_threshold_sec)&&legacy.call_duration_threshold_sec>=0&&legacy.call_duration_threshold_sec<=14400?legacy.call_duration_threshold_sec:null},webhookTimers:webhookTimers(legacy.webhook_config),webhookShape:shape(legacy.webhook_config,-2),hookTriggerModes:Object.fromEntries(Object.entries(legacy.webhook_config||{}).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,typeof v.trigger_mode==='string'&&/^[a-z0-9_-]{1,32}$/i.test(v.trigger_mode)?v.trigger_mode:null])),hookAuthenticationMatchesAr3d:JSON.stringify(legacy.webhook_config||{}).includes(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN||'__no_token_configured__')};
}
// Confirm that a fallback cannot answer with client information or call tools.
// A version label alone is insufficient: require precisely one verified agent
// and the approved root + agent instruction. Never expose those instructions.
function validRoutingGuard(data,guardId,v){
 const config=assistantVersionConfig(data,v);
 const empty=x=>x==null||(typeof x==='object'&&Object.keys(x).length===0);
 return (data?.id||data?.assistant_id)===guardId&&data.stable_version===v&&
   config?.instruction===GUARD_PROMPT&&Array.isArray(config.agents)&&config.agents.length===1&&
   config.agents[0]?.instruction===GUARD_PROMPT&&
   [config.tools,config.mcp_servers,config.agents[0].tools,config.agents[0].mcp_tools,
    config.agents[0].sub_agents].every(empty);
}
// Operator-confirmed one-time recovery of an already persisted, failed
// shared gateway. Never creates another assistant. Never touches the legacy
// bot, starts a call, edits existing traffic or marks the new bot as stable.
export async function recoverUnknownSharedGateway(env,{actorId,now=Date.now()},{fetcher=fetch}={}){
 const db=env.CONTROL_DB,r=await readSharedGateway(env);
 if(!r||r.state!=='unknown'||r.error_code!=='provider_write_unknown'||
    !uuid(r.guard_assistant_id)||!uuid(r.template_assistant_id)||
    !version(r.template_version)||r.gateway_version!=null||
    r.bot_id!=='66cbf4f6-a52d-4df0-abf0-db5e3b365836'||r.flow_id!=='1393135')
  throw Error('gateway_recovery_not_safe');
 const opts={fetcher},botPath='/voicebots/'+r.bot_id,guardPath='/assistants/'+r.guard_assistant_id;
 const bot=unwrapVoicebot(await voicebotRequest(env,botPath,opts));
 const stable=bot.stable_version;
 if((bot.id||bot.bot_id)!==r.bot_id||!version(stable)||
    bot.latest_version!==stable||bot.traffic_allocation?.[stable]!==100||
    Object.entries(bot.traffic_allocation||{}).some(([v,n])=>v!==stable&&Number(n)>0))
  throw Error('gateway_provider_changed_stop');
 const sourceBot=unwrapVoicebot(await voicebotRequest(env,botPath+'?version='+stable,opts));
 if((sourceBot.id||sourceBot.bot_id)!==r.bot_id||
    (sourceBot.assistant_config?.id||sourceBot.assistant_config?.assistant_id)!==r.template_assistant_id)
  throw Error('gateway_provider_changed_stop');
 const guard=unwrapVoicebot(await voicebotRequest(env,guardPath,opts));
 const guardVersion=guard.stable_version;
 if((guard.id||guard.assistant_id)!==r.guard_assistant_id||
    !version(guardVersion)||guard.latest_version!==guardVersion)
  throw Error('gateway_guard_changed_stop');
 const guardData=unwrapVoicebot(await voicebotRequest(env,guardPath+'?version='+guardVersion,opts));
 if((guardData.id||guardData.assistant_id)!==r.guard_assistant_id)
  throw Error('gateway_guard_identity_mismatch');
 let certified=validRoutingGuard(guardData,r.guard_assistant_id,guardVersion);
 let template=null;
 if(!certified){
  // Reuse the original approved template rather than trusting the failed
  // guard's potentially incomplete agent list or unverified model settings.
  const raw=unwrapVoicebot(await voicebotRequest(env,'/assistants/'+r.template_assistant_id+'?version='+r.template_version,opts));
  template=assistantVersionConfig(raw,r.template_version);
  const empty=x=>x==null||(typeof x==='object'&&Object.keys(x).length===0);
  if((raw.id||raw.assistant_id)!==r.template_assistant_id||
     !template||!Array.isArray(template.agents)||template.agents.length!==1||
     ![template.tools,template.mcp_servers,template.agents[0].tools,
       template.agents[0].mcp_tools,template.agents[0].sub_agents].every(empty))
   throw Error('gateway_guard_template_unverified');
 }
 const at=new Date(now).toISOString();
 const lock=await db.prepare("UPDATE shared_voice_gateway SET error_code='repair_in_progress',updated_by=?,updated_at=? WHERE id=1 AND state='unknown' AND error_code='provider_write_unknown' AND guard_assistant_id=? AND gateway_version IS NULL")
  .bind(actorId,at,r.guard_assistant_id).run();
 if(lock.meta.changes!==1)throw Error('gateway_recovery_already_started');
 let phase='preflight';
 try{
  let approvedVersion=guardVersion;
  if(!certified){
   // This is a new version on the already recorded GUARD assistant, not a new
   // assistant and not a change to either existing live Voicebot version.
   phase='guard_version_write';
   const agent={...template.agents[0],id:crypto.randomUUID(),
    name:'Property enquiry assistant',description:'AR3D safe routing fallback',instruction:GUARD_PROMPT};
   const posted=unwrapVoicebot(await voicebotRequest(env,guardPath+'/versions',{
    ...opts,method:'POST',body:{source_version:guardVersion,mark_as_stable:'true',
     version_description:'Verified AR3D routing guard, no customer information',
     data:{instruction:GUARD_PROMPT,llm_config:template.llm_config,
      intent_detection_config:template.intent_detection_config,agents:[agent]}}}));
   approvedVersion=posted.version||posted.latest_version;
   if(!version(approvedVersion)||approvedVersion===guardVersion)
    throw Error('gateway_guard_version_write_unknown');
   phase='guard_version_verify';
   const checked=unwrapVoicebot(await voicebotRequest(env,guardPath+'?version='+approvedVersion,opts));
   if(!validRoutingGuard(checked,r.guard_assistant_id,approvedVersion))
    throw Error('gateway_guard_version_unverified');
   certified=true;
  }
  // Abort if the source Bot changed during the long guard-verification flow.
  const currentBot=unwrapVoicebot(await voicebotRequest(env,botPath,opts));
  if((currentBot.id||currentBot.bot_id)!==r.bot_id||
    currentBot.stable_version!==stable||currentBot.latest_version!==stable||
    currentBot.traffic_allocation?.[stable]!==100)
   throw Error('gateway_provider_changed_stop');
  // Write a PAUSED candidate Bot version. Only the operator can assign traffic
  // later, once the session router/rollout requirements are verified.
  phase='bot_version_write';
  const assistant_config={...sourceBot.assistant_config,
   id:r.guard_assistant_id,version:approvedVersion};
  delete assistant_config.assistant_id;delete assistant_config.assistant_version;
  const postedBot=unwrapVoicebot(await voicebotRequest(env,botPath+'/versions',{
   ...opts,method:'POST',body:{source_version:stable,mark_as_stable:'false',
    version_description:'AR3D shared gateway candidate, paused pending authenticated routing',
    data:{name:'AR3D Client Calling Gateway',assistant_config}}}));
  const candidate=postedBot.version||postedBot.latest_version;
  if(!version(candidate)||candidate===stable)throw Error('gateway_bot_version_write_unknown');
  phase='bot_version_verify';
  const verified=unwrapVoicebot(await voicebotRequest(env,botPath+'?version='+candidate,opts));
  const after=unwrapVoicebot(await voicebotRequest(env,botPath,opts));
  if((verified.id||verified.bot_id)!==r.bot_id||
     (verified.assistant_config?.id||verified.assistant_config?.assistant_id)!==r.guard_assistant_id||
     (verified.assistant_config?.version||verified.assistant_config?.assistant_version)!==approvedVersion||
     after.stable_version!==stable||after.traffic_allocation?.[stable]!==100||
     after.latest_version!==candidate||
     Number(after.traffic_allocation?.[candidate]||0)!==0)
   throw Error('gateway_bot_version_unverified');
  phase='database_finalize';
  const updated=await db.prepare("UPDATE shared_voice_gateway SET state='staged',gateway_version=?,error_code='router_connection_required',updated_by=?,updated_at=? WHERE id=1 AND state='unknown' AND error_code='repair_in_progress' AND guard_assistant_id=?")
   .bind(candidate,actorId,at,r.guard_assistant_id).run();
  if(updated.meta.changes!==1)throw Error('gateway_recovery_state_unconfirmed');
  return {state:'staged',version:candidate,
   notice:'Gateway candidate '+candidate+' created with 0% traffic and verified guard. No live calls, no rollout. Next: review Exotel rollout and authenticated session routing.'};
 }catch(e){
  // A provider write or read-back may have succeeded despite a timeout. The
  // lock remains a non-retriable error until manually reconciled.
  await db.prepare("UPDATE shared_voice_gateway SET error_code=?,updated_at=? WHERE id=1 AND state='unknown' AND error_code='repair_in_progress'")
   .bind(phase==='preflight'?'recovery_check_failed':phase.startsWith('guard_')?'guard_repair_unknown':'bot_repair_unknown',at).run();
  throw Error(phase==='preflight'?'gateway_recovery_preflight_failed':'gateway_recovery_write_unknown_stop');
 }
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
 if(!hooks||Array.isArray(hooks))throw Error('webhook_template_contract_unverified');
 cloneOwnedWebhook(hooks.session_end,'session-end',GATEWAY_CALLBACK);
 const at=new Date(now).toISOString();
 await db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,state,updated_by,updated_at) VALUES(1,?,?,?,?,'configuring',?,?)").bind(botId,flowId,templateId,templateVersion,actorId,at).run();
 try{
  const runtime={template_assistant_id:templateId,template_version:templateVersion};
  const guard=await createIsolatedPublishedAssistant(env,runtime,GUARD_PROMPT,'Routing guard',{fetcher,onCreated:async id=>{await db.prepare('UPDATE shared_voice_gateway SET guard_assistant_id=? WHERE id=1').bind(id).run()}});
  const assistant_config={...bot.assistant_config,id:guard.assistantId,version:null};delete assistant_config.assistant_id;delete assistant_config.assistant_version;
  const result=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+botId+'/versions',{...options,method:'POST',body:{source_version:stable,version_description:'AR3D shared multi-client gateway: authenticated session router and isolated fallback',data:{name:'AR3D Client Calling Gateway',assistant_config}}}));
  const v=result.version||result.latest_version;if(!version(v))throw Error();
  await db.prepare("UPDATE shared_voice_gateway SET state='staged',gateway_version=?,error_code='router_connection_required',updated_at=? WHERE id=1 AND state='configuring'").bind(v,at).run();
  return {version:v,state:'staged',notice:'Shared gateway prepared. Roll this version out once, then connect its authenticated session router below. New clients will not need Exotel dashboard work.'};
 }catch{await db.prepare("UPDATE shared_voice_gateway SET state='unknown',error_code='provider_write_unknown',updated_at=? WHERE id=1").bind(at).run();throw Error('gateway_setup_unknown_review_before_retry')}
}

export async function connectSharedGatewayRouter(env,{authTemplateBotId,actorId,now=Date.now()},{fetcher=fetch}={}){
 if(!uuid(authTemplateBotId))throw Error('invalid_webhook_template');
 const db=env.CONTROL_DB,runtime=await readSharedGateway(env);
 if(!runtime||!['staged','unknown'].includes(runtime.state)||!uuid(runtime.guard_assistant_id))throw Error('shared_gateway_rollout_required');
 const options={fetcher},path='/voicebots/'+runtime.bot_id;
 const live=unwrapVoicebot(await voicebotRequest(env,path,options)),stable=live.stable_version;
 if(!version(stable)||live.traffic_allocation?.[stable]!==100)throw Error('shared_gateway_rollout_required');
 const current=unwrapVoicebot(await voicebotRequest(env,path,{...options,apiVersion:'v1'}));
 if((current.assistant_config?.id||current.assistant_config?.assistant_id)!==runtime.guard_assistant_id)throw Error('shared_gateway_guard_mismatch');
 const auth=unwrapVoicebot(await voicebotRequest(env,'/voicebots/'+authTemplateBotId,{...options,apiVersion:'v1'}));
 const hooks=auth.webhook_config||{};
 const webhook_config={...(current.webhook_config||{}),session_start:cloneOwnedWebhook(hooks.session_end,'session-end',GATEWAY_CALLBACK),session_end:cloneOwnedWebhook(hooks.session_end,'session-end','https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/session-end'),transcript_events:cloneOwnedWebhook(hooks.transcript_events,'transcript-events','https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/transcript-events')};
 const at=new Date(now).toISOString();let didWrite=false;
 try{
  // Exotel's official legacy config contract is GET full config, merge and PUT.
  // Its versioned read deliberately omits HTTP action details, so hooks must be
  // installed through this supported endpoint after the guard rollout.
  await voicebotRequest(env,path,{...options,apiVersion:'v1',method:'PUT',body:{...current,enable_call_threshold:true,call_duration_threshold_sec:120,webhook_config}});didWrite=true;
  const saved=unwrapVoicebot(await voicebotRequest(env,path,{...options,apiVersion:'v1'}));
  const after=unwrapVoicebot(await voicebotRequest(env,path,options)),v=after.stable_version;
  if(!version(v)||after.traffic_allocation?.[v]!==100||saved.enable_call_threshold!==true||saved.call_duration_threshold_sec!==120||(saved.assistant_config?.id||saved.assistant_config?.assistant_id)!==runtime.guard_assistant_id||!JSON.stringify(saved.webhook_config?.session_start||{}).includes(GATEWAY_CALLBACK))throw Error('provider_write_unknown');
  await db.prepare("UPDATE shared_voice_gateway SET state='staged',gateway_version=?,error_code=NULL,updated_by=?,updated_at=? WHERE id=1 AND guard_assistant_id=?").bind(v,actorId,at,runtime.guard_assistant_id).run();
  return {state:'staged',version:v,notice:'Authenticated session router connected. Publish a client agent and run one verified-phone gateway test.'};
 }catch(e){
  const known=!didWrite&&/^(?:provider_http_(?:400|401|403|404|422|429)|voicebot_management_access_denied)$/.test(e.message);
  if(!known)await db.prepare("UPDATE shared_voice_gateway SET state='unknown',error_code='provider_write_unknown',updated_at=? WHERE id=1").bind(at).run();
  throw Error(known?e.message:'gateway_router_write_unknown_review_before_retry');
 }
}
