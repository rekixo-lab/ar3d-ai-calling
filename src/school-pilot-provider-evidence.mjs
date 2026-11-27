// Phase 3D: disconnected signed outbound Plivo evidence adapter.
// There is no dispatch function, route, XML playback or live activation here.
// A future funded server dispatcher must record its authentic accepted response;
// the helper must never accept request IDs from a human/client-supplied body.
import {verifySchoolPlivoGet} from './school-pilot-readiness.mjs';
import {pilotSha,schoolTarget,readActiveSchoolPermit} from './school-internal-permits.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const fail=x=>{throw Error(x)};
const e164=x=>typeof x==='string'&&/^\+?[1-9][0-9]{7,14}$/.test(x)?(x.startsWith('+')?x:'+'+x):null;
export async function recordAcceptedSchoolRequest(env,{tenantId,permitId,requestUUID,now=Date.now()}){
 if(!uuid(requestUUID)||env.AR3D_SCHOOL_PILOT_LIVE_ENABLED!=='approved')fail('school_provider_dispatch_disabled');
 const {row}=await readActiveSchoolPermit(env,tenantId,permitId,now);
 if(row.audio_state!=='ready')fail('school_pilot_audio_not_ready');
 const r=await env.CONTROL_DB.prepare("INSERT INTO school_internal_provider_evidence(permit_id,request_uuid) SELECT id,? FROM school_internal_pilot_permits WHERE id=? AND tenant_id=? AND audio_state='ready' AND stopped_at IS NULL AND expires_at>?")
  .bind(requestUUID,permitId,tenantId,now).run();
 if(r.meta.changes!==1)fail('school_provider_request_not_recorded');
 return {recorded:true,liveCall:false};
}
export async function acceptSchoolProviderCallback(req,env,{now=Date.now()}={}){
 const origin=env.AR3D_SCHOOL_PILOT_ORIGIN,token=env.PLIVO_AUTH_TOKEN;
 if(!await verifySchoolPlivoGet(req,{origin,token}))fail('school_provider_signature_invalid');
 const q=new URL(req.url).searchParams,permitId=q.get('permitId'),requestUUID=q.get('RequestUUID'),callUUID=q.get('CallUUID');
 const kind=q.get('Event'),status=q.get('CallStatus'),isAnswer=kind==='StartApp'&&status==='in-progress',isEnd=kind==='Hangup'&&status==='completed';
 if(!uuid(permitId)||!uuid(requestUUID)||!uuid(callUUID)||q.get('Direction')!=='outbound'||(!isAnswer&&!isEnd))
  fail('school_provider_event_invalid');
 const db=env.CONTROL_DB,nonceHash=await pilotSha(req.headers.get('X-Plivo-Signature-V3-Nonce'));
 for(let i=0;i<3;i++){
  const row=await db.prepare('SELECT e.*,p.tenant_id,p.target_sha256,p.stopped_at,p.expires_at,p.created_at,p.audio_state FROM school_internal_provider_evidence e JOIN school_internal_pilot_permits p ON p.id=e.permit_id WHERE e.permit_id=? AND e.request_uuid=?').bind(permitId,requestUUID).first();
  if(!row||row.created_at>now||row.expires_at+86400000<now)fail('school_provider_request_unknown');
  const target=await schoolTarget(env,row.tenant_id);
  if(row.target_sha256!==target.hash||e164(q.get('From'))!==target.caller||e164(q.get('To'))!==target.recipient||
   (row.call_uuid&&row.call_uuid!==callUUID))fail('school_provider_binding_mismatch');
  const prior=isAnswer?row.answer_nonce_hash:row.hangup_nonce_hash;
  const other=isAnswer?row.hangup_nonce_hash:row.answer_nonce_hash;
  if(other===nonceHash)fail('school_provider_nonce_conflict');
  if(prior)return {accepted:true,duplicate:true,ended:!!row.ended,liveCall:false};
  if(isAnswer&&(row.ended||row.stopped_at!==null||row.expires_at<=now||row.audio_state!=='ready'||
    env.AR3D_SCHOOL_PILOT_LIVE_ENABLED!=='approved'))fail('school_provider_answer_blocked');
  const query=isAnswer?
   "UPDATE school_internal_provider_evidence SET call_uuid=?,answer_nonce_hash=?,revision=revision+1 WHERE permit_id=? AND revision=? AND ended=0 AND EXISTS(SELECT 1 FROM school_internal_pilot_permits p WHERE p.id=permit_id AND p.stopped_at IS NULL AND p.expires_at>? AND p.audio_state='ready')":
   "UPDATE school_internal_provider_evidence SET call_uuid=?,hangup_nonce_hash=?,ended=1,revision=revision+1 WHERE permit_id=? AND revision=? AND ended=0";
  const args=[callUUID,nonceHash,permitId,row.revision,...(isAnswer?[now]:[])];
  const changed=await db.prepare(query).bind(...args).run();
  if(changed.meta.changes===1)return {accepted:true,duplicate:false,ended:isEnd,liveCall:false};
 }
 fail('school_provider_callback_conflict');
}
