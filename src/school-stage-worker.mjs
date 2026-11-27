// Separate staging Worker entrypoint. Never import from the production Worker.
// Bind ONLY a newly provisioned stage DB and private stage audio bucket.
import {handleHumanRequest} from './human-routes.mjs';
import {getSession,mutationOriginAllowed} from './human-auth.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
import {approveSchoolInternalPilot,requireSchoolPilotMfa} from './school-internal-permits.mjs';
import {generateSchoolPilotAudio} from './school-pilot-audio.mjs';
import {dispatchSchoolStageCall,schoolStageConfig,stopSchoolStageCall} from './school-stage-dispatch.mjs';
import {handleSchoolStageRequest} from './school-stage-voice-runtime.mjs';
import {stageDatabaseIdentity,stageSetupStatus,seedStageSchoolDemo} from './school-stage-setup.mjs';
import {handleIndustryFlowSnapshots} from './industry-flow-snapshots.mjs';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const reply=(body,status=200)=>Response.json(body,{status,headers});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const authRoutes=new Set(['/v1/human/login','/v1/human/login/mfa','/v1/human/logout','/v1/human/mfa','/v1/human/mfa/setup','/v1/human/mfa/enable']);
export async function handleSchoolStageWorker(req,bindings,{clock=Date.now,fetcher=fetch}={}){
 const url=new URL(req.url);
 if(bindings.AR3D_SCHOOL_STAGE_ISOLATED_DB_CONFIRMED!=='yes'||!bindings.SCHOOL_STAGE_CONTROL_DB||
  bindings.SCHOOL_STAGE_CONTROL_DB===bindings.CONTROL_DB||url.origin!==bindings.AR3D_SCHOOL_STAGE_ORIGIN)return reply({error:'stage_unavailable'},503);
 const env={...bindings,CONTROL_DB:bindings.SCHOOL_STAGE_CONTROL_DB};
 if(!await stageDatabaseIdentity(env))return reply({error:'stage_database_identity_unavailable'},503);
 if(url.pathname==='/health'&&req.method==='GET')return reply({service:'school-internal-stage',production:false,stageDatabaseVerified:true,liveEnabled:env.AR3D_SCHOOL_STAGE_ENABLED==='approved'});
 try{
  const provider=await handleSchoolStageRequest(req,env,{clock,fetcher});
  if(provider)return provider;
  // Authentication endpoints only; no legacy CRM, calling, wallet or public UI.
  if(url.pathname==='/v1/human/bootstrap'){
   if(req.method!=='POST'||url.search||!mutationOriginAllowed(req)||
    env.AR3D_SCHOOL_STAGE_BOOTSTRAP_ENABLED!=='approved'||env.AR3D_SCHOOL_STAGE_ENABLED==='approved'||
    env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED==='approved'||env.AR3D_SCHOOL_PILOT_APPROVAL_ENABLED==='approved'||
    typeof env.AR3D_SCHOOL_STAGE_BOOTSTRAP_TOKEN!=='string'||env.AR3D_SCHOOL_STAGE_BOOTSTRAP_TOKEN.length<32)
    return reply({error:'stage_bootstrap_disabled'},403);
   // Existing singleton bootstrap, using a stage-only secret (never the legacy token).
   return await handleHumanRequest(req,{...env,ADMIN_BOOTSTRAP_TOKEN:env.AR3D_SCHOOL_STAGE_BOOTSTRAP_TOKEN});
  }
  if(authRoutes.has(url.pathname))return await handleHumanRequest(req,env)||reply({error:'not_found'},404);
  if(url.pathname==='/v1/human/school-stage/status'&&req.method==='GET'&&!url.search){
   const user=await getSession(req,env.CONTROL_DB);
   if(!user||user.globalRole!=='super_admin')return reply({error:'mfa_super_admin_required'},403);
   return reply(await stageSetupStatus(env,user,{now:clock()}));
  }
  const review=url.pathname.match(/^\/v1\/human\/ai-flow-snapshots\/([a-f0-9-]{36})\/review$/i);
  if(review){
   if(req.method!=='POST'||url.search||!mutationOriginAllowed(req)||env.AR3D_SCHOOL_STAGE_ENABLED==='approved')
    return reply({error:'locked_stage_review_required'},403);
   const user=await getSession(req,env.CONTROL_DB);
   if(!user||user.globalRole!=='super_admin')return reply({error:'mfa_super_admin_required'},403);
   await requireSchoolPilotMfa(env.CONTROL_DB,user,clock());
   const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,4096)));
   if(data?.tenantId!==env.AR3D_SCHOOL_PILOT_TENANT_ID)return reply({error:'stage_tenant_mismatch'},403);
   return await handleIndustryFlowSnapshots(new Request(req.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env,user,{now:clock()})||reply({error:'not_found'},404);
  }
  const action=url.pathname.match(/^\/v1\/human\/school-stage\/(seed|approve|prepare-audio|dispatch|stop)$/)?.[1];
  if(!action)return reply({error:'not_found'},404);
  if(req.method!=='POST'||url.search||!mutationOriginAllowed(req))return reply({error:'same_origin_post_required'},403);
  const user=await getSession(req,env.CONTROL_DB);
  if(!user||user.globalRole!=='super_admin')return reply({error:'mfa_super_admin_required'},403);
  await requireSchoolPilotMfa(env.CONTROL_DB,user,clock());
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply({error:'json_required'},400);
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,4096)));
  if(action==='stop'){
   if(!exact(data,['tenantId','permitId']))return reply({error:'invalid_stage_request'},400);
   return reply(await stopSchoolStageCall(env,user,data,{clock,fetcher}));
  }
  if(action==='seed')return reply(await seedStageSchoolDemo(env,user,data,{now:clock()}),201);
  const c=schoolStageConfig(env);
  if(action==='approve')return reply(await approveSchoolInternalPilot(env,user,data,{now:clock()}),201);
  if(action==='prepare-audio'){
   if(!exact(data,['tenantId','permitId','confirm'])||data.confirm!=='ONE_STAGE_AUDIO_JOB_WITH_REVIEWED_TTS_BUDGET')
    return reply({error:'explicit_audio_funding_confirmation_required'},400);
   // Dedicated stage Sarvam key. Existing one-use claim and character cap apply.
   // TTS funding is explicitly reviewed separately from the voice-call reserve.
   return reply(await generateSchoolPilotAudio({...env,SARVAM_API_KEY:c.sttKey},user,
    {tenantId:data.tenantId,permitId:data.permitId},{clock,fetcher}));
  }
  return reply(await dispatchSchoolStageCall(env,user,data,{clock,fetcher}));
 }catch(e){
  // No raw provider payloads, identifiers, credentials, or stack traces returned.
  const code=String(e?.message||'');
  return reply({error:/^school_[a-z_]{1,100}$/.test(code)?code:'school_stage_operation_unavailable'},409);
 }
}
export default {fetch(req,env){return handleSchoolStageWorker(req,env)}};
