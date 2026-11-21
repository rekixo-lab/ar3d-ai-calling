import {mutationOriginAllowed} from './human-auth.mjs';
import {readSharedGateway,inspectGatewayConfiguration,prepareSharedGateway,verifySharedGatewayLive,connectSharedGatewayRouter,reviewUnknownGateway,recoverUnknownSharedGateway,previewUnknownSharedGatewayRecovery,inspectUnknownGuardRepair,previewGuardAgentOnlyFix,fixGuardAgentOnlyOnce} from './shared-voice-gateway.mjs';
const path='/v1/human/voice-gateway';
// Existing owner-supplied, non-secret Exotel resource IDs. These are suggested
// only to the authenticated MFA Super Admin if no gateway has been configured.
// Never copy the old working bot/flow into the new shared gateway record.
export const KNOWN_SHARED_GATEWAY_BOOTSTRAP=Object.freeze({
 botId:'66cbf4f6-a52d-4df0-abf0-db5e3b365836',
 flowId:'1393135',
 authTemplateBotId:'c3c7ca7c-b06d-4b3d-b661-ef121f751021'
});
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleVoiceGatewayRequest(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 if(new URL(req.url).pathname!==path)return null;
 if(user.globalRole!=='super_admin')return json({error:'forbidden'},403);
 if(!await env.CONTROL_DB.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1').bind(user.id,user.token_hash,now).first())return json({error:'current_super_admin_mfa_required'},403);
 if(!['GET','POST'].includes(req.method))return json({error:'method_not_allowed'},405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return json({error:'same_origin_required'},403);
 try{
  const runtime=await readSharedGateway(env);
  if(req.method==='GET')return json({
   gateway:runtime?{state:runtime.state,botId:runtime.bot_id,flowId:runtime.flow_id,version:runtime.gateway_version,lastVerifiedAt:runtime.last_verified_at,errorCode:runtime.error_code}:null,
   suggestedGateway:runtime?null:KNOWN_SHARED_GATEWAY_BOOTSTRAP,
   knownAuthTemplateBotId:KNOWN_SHARED_GATEWAY_BOOTSTRAP.authTemplateBotId,
   flowTargetVerified:false,
   notice:runtime?'Existing gateway preserved.':'Known owner-supplied Exotel resource IDs loaded read-only. The copied Flow may still point to the old bot: inspect and independently verify in Exotel before preparation.'
  });
  if(!req.body||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'invalid_json'},400);
  const reader=req.body.getReader();let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>2048){await reader.cancel();return json({error:'request_too_large'},413)}raw+=decoder.decode(r.value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
  const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))return json({error:'invalid_request'},400);
  if(d.action==='review'&&Object.keys(d).length===1)return json(await reviewUnknownGateway(env,runtime,{fetcher}));
  if(d.action==='repair-preview'&&Object.keys(d).length===1)return json(await previewUnknownSharedGatewayRecovery(env,runtime,{fetcher}));
  if(d.action==='repair-review'&&Object.keys(d).length===1)return json(await inspectUnknownGuardRepair(env,runtime,{fetcher}));
  if(d.action==='agent-only-preview'&&Object.keys(d).length===1)return json(await previewGuardAgentOnlyFix(env,runtime,{fetcher}));
  if(d.action==='agent-only-fix'&&Object.keys(d).sort().join(',')==='action,confirmation'){
   if(d.confirmation!=='CREATE_ONE_AGENT_ONLY_GUARD_VERSION_PAUSED_NO_CALLS')return json({error:'explicit_agent_fix_confirmation_required'},409);
   return json(await fixGuardAgentOnlyOnce(env,{actorId:user.id,now},{fetcher}));
  }
  if(d.action==='recover'&&Object.keys(d).sort().join(',')==='action,confirmation'){
   if(d.confirmation!=='REPAIR_ONLY_SHARED_GUARD_NO_CALLS')return json({error:'explicit_recovery_confirmation_required'},409);
   return json(await recoverUnknownSharedGateway(env,{actorId:user.id,now},{fetcher}));
  }
  if(d.action==='inspect'&&Object.keys(d).sort().join(',')==='action,botId')return json(await inspectGatewayConfiguration(env,d.botId,{fetcher}));
  if(d.action==='configure'&&Object.keys(d).sort().join(',')==='action,authTemplateBotId,botId,flowId,flowTargetConfirmed'){
   if(d.flowTargetConfirmed!==true)return json({error:'flow_target_confirmation_required'},409);
   const {botId,flowId,authTemplateBotId}=d;
   if(flowId===KNOWN_SHARED_GATEWAY_BOOTSTRAP.flowId&&botId!==KNOWN_SHARED_GATEWAY_BOOTSTRAP.botId)
    return json({error:'copied_flow_must_target_shared_bot'},409);
   return json(await prepareSharedGateway(env,{botId,flowId,authTemplateBotId,actorId:user.id,now},{fetcher}));
  }
  if(d.action==='connect'&&Object.keys(d).sort().join(',')==='action,authTemplateBotId')return json(await connectSharedGatewayRouter(env,{authTemplateBotId:d.authTemplateBotId,actorId:user.id,now},{fetcher}));
  if(d.action==='verify'&&Object.keys(d).length===1){await verifySharedGatewayLive(env,runtime,{fetcher});return json({rolloutVerified:true,routingVerified:runtime.state==='ready',notice:runtime.state==='ready'?'Shared client calling connection verified.':'Provider rollout verified. One authenticated verified-phone routing test is still required.'})}
  return json({error:'invalid_request'},400);
 }catch(e){return json({error:/^[a-z0-9_]+$/.test(e.message)?e.message:'gateway_unavailable'},503)}
}
