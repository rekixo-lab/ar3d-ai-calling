import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {parseJsonBody} from './core.mjs';
import {defaultScript,validateScript,compileScript} from './calling-script-core.mjs';
import {scriptProviderConfiguration,stageScript,probeScriptProvider,createIsolatedPublishedAssistant} from './calling-script-provider.mjs';
import {readSharedGateway,verifySharedGatewayLive} from './shared-voice-gateway.mjs';
import {compileCompanyFacts} from './company-profile.mjs';
const BASE='/v1/human/calling-scripts';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function read(req){
 if(!req.body||!req.headers.get('content-type')?.startsWith('application/json'))throw Error('invalid_json');
 const reader=req.body.getReader(),dec=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>100000){await reader.cancel();throw Error('body_too_large')}raw+=dec.decode(value,{stream:true})}raw+=dec.decode()}finally{reader.releaseLock()}
 return parseJsonBody(raw,100000);
}
async function freshAdmin(db,user,now){
 return user.globalRole==='super_admin'&&!!await db.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1').bind(user.id,user.token_hash,now).first();
}
export async function handleCallingScripts(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 const url=new URL(req.url),path=url.pathname;
 if(path!==BASE&&!path.startsWith(BASE+'/'))return null;
 const action=path===BASE?'versions':path.slice(BASE.length+1),db=env.CONTROL_DB;
 const fail=(error,status=400)=>json({error},status);
 if(!['versions','binding','stage','probe','publish'].includes(action))return fail('not_found',404);
 if(!['GET','POST'].includes(req.method)||['stage','probe','publish'].includes(action)&&req.method!=='POST')return fail('method_not_allowed',405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return fail('same_origin_required',403);
 try{
  const d=req.method==='POST'?await read(req):Object.fromEntries(url.searchParams);
  if(!UUID.test(d.tenantId||''))return fail('invalid_tenant');
  const isAdmin=await freshAdmin(db,user,now);
  if(user.globalRole==='super_admin'&&!isAdmin)return fail('current_super_admin_mfa_required',403);
  if(isAdmin){if(!await db.prepare("SELECT id FROM tenants WHERE id=? AND status IN('trial','active')").bind(d.tenantId).first())return fail('tenant_unavailable',404)}
  else if(!await requireMembership(db,user,d.tenantId,req.method==='POST'))return fail('forbidden',403);
  if(!['versions','publish'].includes(action)&&!isAdmin)return fail('super_admin_required',403);
  const tid=d.tenantId,at=new Date(now).toISOString();
  if(action==='probe'){
   if(Object.keys(d).some(k=>!['tenantId','botId'].includes(k))||!UUID.test(d.botId||''))return fail('invalid_bot');
   try{return json(await probeScriptProvider(env,d.botId,{fetcher}))}catch(e){return fail(String(e.message),502)}
  }
  if(action==='versions'&&req.method==='GET'){
   const rows=await db.prepare('SELECT id,revision,config_json,provider_state AS providerState,provider_version AS providerVersion,error_code AS errorCode,created_at AS createdAt,synced_at AS syncedAt FROM calling_script_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 50').bind(tid).all();
   const publication=await db.prepare('SELECT id,script_revision AS scriptRevision,profile_revision AS profileRevision,provider_state AS state,provider_version AS providerVersion,error_code AS errorCode,published_at AS publishedAt FROM calling_agent_publications WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1').bind(tid).first();
   const profile=await db.prepare('SELECT MAX(revision) AS revision FROM company_profile_versions WHERE tenant_id=?').bind(tid).first();
   return json({publication,profileRevision:profile?.revision||0,versions:rows.results.map(({config_json,...r})=>({...r,config:JSON.parse(config_json)})),defaults:defaultScript(),canEdit:isAdmin||!!await requireMembership(db,user,tid,true),canStage:isAdmin,notice:'Saved scripts require Exotel version sync and a verified rollout before they affect calls.'});
  }
  if(action==='versions'){
   if(Object.keys(d).some(k=>!['tenantId','baseRevision','config'].includes(k))||!Number.isInteger(d.baseRevision)||d.baseRevision<0)return fail('invalid_revision');
   const config=validateScript(d.config),prompt=compileScript(config),id=crypto.randomUUID();
   // Atomic compare-and-save prevents silent overwrites between tabs/operators.
   const result=await db.prepare('INSERT INTO calling_script_versions(tenant_id,id,revision,config_json,prompt,created_by,created_at) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM calling_script_versions WHERE tenant_id=?),0)=?').bind(tid,id,d.baseRevision+1,JSON.stringify(config),prompt,user.id,at,tid,d.baseRevision).run();
   if(result.meta.changes!==1)return fail('script_changed_refresh_first',409);
   return json({id,revision:d.baseRevision+1,providerState:'draft',prompt},201);
  }
  const binding=await db.prepare('SELECT * FROM calling_script_bindings WHERE tenant_id=?').bind(tid).first();
  if(action==='publish'){
   if(Object.keys(d).some(k=>!['tenantId','id','profileRevision'].includes(k))||!UUID.test(d.id||'')||!Number.isInteger(d.profileRevision)||d.profileRevision<1)return fail('save_company_information_first');
   const runtime=await readSharedGateway(env);
   if(!runtime||!['staged','ready'].includes(runtime.state))return fail('shared_gateway_setup_required',409);
   try{await verifySharedGatewayLive(env,runtime,{fetcher})}catch(e){return fail(e.message,409)}
   const script=await db.prepare('SELECT * FROM calling_script_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 1').bind(tid).first();
   const profile=await db.prepare('SELECT * FROM company_profile_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 1').bind(tid).first();
   if(!script||script.id!==d.id||profile?.revision!==d.profileRevision)return fail('company_or_script_changed_refresh_first',409);
   const existing=await db.prepare("SELECT id,provider_version FROM calling_agent_publications WHERE tenant_id=? AND script_revision=? AND profile_revision=? AND provider_state='ready' AND provider_bot_id=? ORDER BY created_at DESC LIMIT 1").bind(tid,script.revision,profile.revision,runtime.bot_id).first();
   if(existing)return json({published:true,providerVersion:existing.provider_version,alreadyPublished:true});
   const prompt=compileScript(JSON.parse(script.config_json))+'\n\n'+compileCompanyFacts(JSON.parse(profile.config_json)),id=crypto.randomUUID(),earliest=new Date(now-86400000).toISOString();
   const lock=await db.prepare("INSERT INTO calling_agent_publications(tenant_id,id,script_revision,profile_revision,prompt,greeting,provider_bot_id,provider_state,created_by,created_at) SELECT ?,?,?,?,?,?,?,'sending',?,? WHERE (SELECT MAX(revision) FROM calling_script_versions WHERE tenant_id=?)=? AND (SELECT MAX(revision) FROM company_profile_versions WHERE tenant_id=?)=? AND NOT EXISTS(SELECT 1 FROM calling_script_versions WHERE tenant_id=? AND provider_state IN('sending','unknown')) AND NOT EXISTS(SELECT 1 FROM calling_agent_publications WHERE tenant_id=? AND provider_state IN('sending','unknown')) AND (SELECT COUNT(*) FROM calling_agent_publications WHERE tenant_id=? AND created_at>=?)<10").bind(tid,id,script.revision,profile.revision,prompt,JSON.parse(script.config_json).greeting,runtime.bot_id,user.id,at,tid,script.revision,tid,profile.revision,tid,tid,tid,earliest).run();
   if(lock.meta.changes!==1)return fail('publication_in_progress_or_daily_limit',409);
   let written=false;
   try{
    const company=JSON.parse(profile.config_json).companyName;
    const result=await createIsolatedPublishedAssistant(env,runtime,prompt,company,{fetcher,onCreated:async assistantId=>{await db.prepare("UPDATE calling_agent_publications SET provider_assistant_id=? WHERE tenant_id=? AND id=? AND provider_state='sending' AND provider_assistant_id IS NULL").bind(assistantId,tid,id).run()}});written=true;
    await db.batch([
     db.prepare("UPDATE calling_agent_publications SET provider_state='ready',provider_version=?,published_at=? WHERE tenant_id=? AND id=? AND provider_state='sending'").bind(result.version,at,tid,id)
    ]);
    return json({published:true,providerVersion:result.version,notice:'Company knowledge and conversation published. The dedicated agent will use this version for subsequent calls.'});
   }catch(e){const code=written?'provider_write_unknown':String(e.message);await db.prepare('UPDATE calling_agent_publications SET provider_state=?,error_code=? WHERE tenant_id=? AND id=?').bind(code==='provider_write_unknown'?'unknown':'failed',code,tid,id).run();return fail(code,502)}
  }
  if(action==='binding'&&req.method==='GET')return json({binding:binding?{botId:binding.bot_id,assistantId:binding.assistant_id,sourceVersion:binding.source_version}:null,configuration:scriptProviderConfiguration(env)});
  if(action==='binding'){
   if(await db.prepare("SELECT id FROM calling_agent_publications WHERE tenant_id=? AND provider_state IN('sending','unknown') LIMIT 1").bind(tid).first())return fail('publication_in_progress',409);
   if(Object.keys(d).some(k=>!['tenantId','botId','assistantId','sourceVersion'].includes(k))||!UUID.test(d.botId||'')||!UUID.test(d.assistantId||'')||!/^v[1-9]\d{0,8}$/.test(d.sourceVersion||''))return fail('invalid_binding');
   if(await db.prepare("SELECT id FROM calling_script_versions WHERE tenant_id=? AND provider_state IN('sending','unknown') LIMIT 1").bind(tid).first())return fail('provider_sync_needs_review',409);
   if(await db.prepare('SELECT tenant_id FROM calling_script_bindings WHERE tenant_id<>? AND (bot_id=? OR assistant_id=?) LIMIT 1').bind(tid,d.botId,d.assistantId).first())return fail('provider_agent_already_assigned',409);
   await db.prepare('INSERT INTO calling_script_bindings VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET bot_id=excluded.bot_id,assistant_id=excluded.assistant_id,source_version=excluded.source_version,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(tid,d.botId,d.assistantId,d.sourceVersion,user.id,at).run();
   return json({saved:true});
  }
  if(Object.keys(d).some(k=>!['tenantId','id'].includes(k))||!UUID.test(d.id||''))return fail('invalid_version');
  if(!binding)return fail('super_admin_binding_required',409);
  if(!scriptProviderConfiguration(env).ready)return fail('voicebot_management_credentials_required',503);
  const version=await db.prepare('SELECT * FROM calling_script_versions WHERE tenant_id=? AND id=?').bind(tid,d.id).first();
  if(!version)return fail('version_not_found',404);
  if(version.provider_state==='saved')return json({providerState:'saved',providerVersion:version.provider_version,liveVerified:false});
  if(!['draft','failed'].includes(version.provider_state))return fail('provider_sync_needs_review',409);
  const lock=await db.prepare("UPDATE calling_script_versions SET provider_state='sending',error_code=NULL,provider_bot_id=?,provider_assistant_id=?,synced_by=? WHERE tenant_id=? AND id=? AND provider_state IN('draft','failed') AND NOT EXISTS(SELECT 1 FROM calling_script_versions v WHERE v.tenant_id=? AND v.provider_state IN('sending','unknown')) AND NOT EXISTS(SELECT 1 FROM calling_agent_publications p WHERE p.tenant_id=calling_script_versions.tenant_id AND p.provider_state IN('sending','unknown'))").bind(binding.bot_id,binding.assistant_id,user.id,tid,d.id,tid).run();
  if(lock.meta.changes!==1)return fail('provider_sync_needs_review',409);
  let providerSucceeded=false;
  try{
   const result=await stageScript(env,binding,version.prompt,{fetcher});
   providerSucceeded=true;
   await db.batch([
    db.prepare("UPDATE calling_script_versions SET provider_state='saved',provider_version=?,synced_at=? WHERE tenant_id=? AND id=? AND provider_state='sending'").bind(result.version,at,tid,d.id),
    db.prepare('UPDATE calling_script_bindings SET source_version=?,updated_by=?,updated_at=? WHERE tenant_id=? AND bot_id=? AND assistant_id=? AND source_version=?').bind(result.version,user.id,at,tid,binding.bot_id,binding.assistant_id,binding.source_version)
   ]);
   return json({providerState:'saved',providerVersion:result.version,liveVerified:false,notice:'Exotel version saved and read back. Review and roll it out in Exotel before using it for live calls.'});
  }catch(e){const error=providerSucceeded?'provider_write_unknown':String(e.message),unknown=error==='provider_write_unknown';await db.prepare('UPDATE calling_script_versions SET provider_state=?,error_code=? WHERE tenant_id=? AND id=?').bind(unknown?'unknown':'failed',error,tid,d.id).run();return fail(error,502)}
 }catch(e){
  const error=String(e.message||'');
  if(/invalid|Agent needs|body_too_large/i.test(error))return fail(error);
  return fail('script_unavailable_refresh_or_check_migration',503);
 }
}
