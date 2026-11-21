import {mutationOriginAllowed} from './human-auth.mjs';
import {readSharedGateway,inspectGatewayConfiguration,prepareSharedGateway,verifySharedGatewayLive} from './shared-voice-gateway.mjs';
const path='/v1/human/voice-gateway';
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleVoiceGatewayRequest(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 if(new URL(req.url).pathname!==path)return null;
 if(user.globalRole!=='super_admin')return json({error:'forbidden'},403);
 if(!await env.CONTROL_DB.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1').bind(user.id,user.token_hash,now).first())return json({error:'current_super_admin_mfa_required'},403);
 if(!['GET','POST'].includes(req.method))return json({error:'method_not_allowed'},405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return json({error:'same_origin_required'},403);
 try{
  const runtime=await readSharedGateway(env);
  if(req.method==='GET')return json({gateway:runtime?{state:runtime.state,botId:runtime.bot_id,flowId:runtime.flow_id,version:runtime.gateway_version,lastVerifiedAt:runtime.last_verified_at,errorCode:runtime.error_code}:null});
  if(!req.body||!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'invalid_json'},400);
  const reader=req.body.getReader();let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>2048){await reader.cancel();return json({error:'request_too_large'},413)}raw+=decoder.decode(r.value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
  const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))return json({error:'invalid_request'},400);
  if(d.action==='inspect'&&Object.keys(d).sort().join(',')==='action,botId')return json(await inspectGatewayConfiguration(env,d.botId,{fetcher}));
  if(d.action==='configure'&&Object.keys(d).sort().join(',')==='action,authTemplateBotId,botId,flowId')return json(await prepareSharedGateway(env,{...d,actorId:user.id,now},{fetcher}));
  if(d.action==='verify'&&Object.keys(d).length===1){await verifySharedGatewayLive(env,runtime,{fetcher});return json({rolloutVerified:true,routingVerified:runtime.state==='ready',notice:runtime.state==='ready'?'Shared client calling connection verified.':'Provider rollout verified. One authenticated verified-phone routing test is still required.'})}
  return json({error:'invalid_request'},400);
 }catch(e){return json({error:/^[a-z0-9_]+$/.test(e.message)?e.message:'gateway_unavailable'},503)}
}
