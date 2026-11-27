// Stage-only provider adapter, deliberately not imported by the production Worker.
import {pilotSha,readActiveSchoolPermit,requireSchoolPilotMfa,stopSchoolInternalPilot} from './school-internal-permits.mjs';
import {SCHOOL_CALLBACK_PATH,verifySchoolAudioBytes} from './school-pilot-readiness.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
const fail=x=>{throw Error(x)};
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const amount=x=>typeof x==='string'&&/^[1-9][0-9]{0,11}$/.test(x)?Number(x):null;
const key=x=>typeof x==='string'&&x.length>=8&&x.length<=512&&!/[\x00-\x20\x7f]/.test(x);
export function schoolStageConfig(env,{forStop=false}={}){
 const authId=env.AR3D_SCHOOL_STAGE_PLIVO_AUTH_ID,token=env.AR3D_SCHOOL_STAGE_PLIVO_AUTH_TOKEN,
  sttKey=env.AR3D_SCHOOL_STAGE_SARVAM_API_KEY,origin=env.AR3D_SCHOOL_STAGE_ORIGIN,mediaSecret=env.AR3D_SCHOOL_STAGE_MEDIA_SECRET;
 // Separate provider account and STT credential; never fall back to legacy secrets.
 if((!forStop&&env.AR3D_SCHOOL_STAGE_ENABLED!=='approved')||!/^[-A-Za-z0-9]{8,64}$/.test(authId||'')||
  !env.PLIVO_AUTH_ID||authId===env.PLIVO_AUTH_ID||!key(token)||token===env.PLIVO_AUTH_TOKEN)
  fail('school_stage_not_configured');
 let u;try{u=new URL(origin)}catch{fail('school_stage_not_configured')}
 if(u.protocol!=='https:'||u.origin!==origin||origin===env.AR3D_SCRIPTED_PILOT_ORIGIN||origin===env.AR3D_SCHOOL_PILOT_ORIGIN)
  fail('school_stage_not_configured');
 const config={authId,token,sttKey,origin,mediaSecret,authorization:'Basic '+btoa(authId+':'+token)};
 if(forStop)return config;
 const plivoCap=amount(env.AR3D_SCHOOL_STAGE_PLIVO_CAP_USD_MICROS),plivoReserve=amount(env.AR3D_SCHOOL_STAGE_PLIVO_RESERVE_USD_MICROS);
 const sarvamCap=amount(env.AR3D_SCHOOL_STAGE_SARVAM_CAP_INR_MICROS),sarvamReserve=amount(env.AR3D_SCHOOL_STAGE_SARVAM_RESERVE_INR_MICROS);
 const fundingRef=env.AR3D_SCHOOL_STAGE_FUNDING_REF;
 if(!key(sttKey)||sttKey===env.SARVAM_API_KEY||!key(mediaSecret)||mediaSecret.length<32||
  env.AR3D_SCHOOL_STAGE_RECORDING_AUTH!=='confirmed'||!plivoCap||!plivoReserve||!sarvamCap||!sarvamReserve||
  plivoReserve>plivoCap||sarvamReserve>sarvamCap||typeof fundingRef!=='string'||!/^[a-zA-Z0-9._:/-]{8,160}$/.test(fundingRef))
  fail('school_stage_funding_or_recording_unavailable');
 return {...config,plivoCap,plivoReserve,sarvamCap,sarvamReserve,fundingRef};
}
export const stageCallback=(c,permitId,step,turn)=>c.origin+SCHOOL_CALLBACK_PATH+'?'+new URLSearchParams({permitId,step,...(turn===undefined?{}:{turn:String(turn)})});
export function linearSchoolNodes(graph){
 const ns=graph.nodes;
 if(ns.length<4||ns.length>6||ns[0].type!=='greeting'||ns.at(-2).type!=='speak_static'||ns.at(-1).type!=='end_call'||
  ns.slice(1,-2).some(n=>n.type!=='ask_text_bounded')||ns.slice(0,-1).some((n,i)=>n.next!==ns[i+1].id))
  fail('school_stage_linear_one_to_three_questions_only');
 return {greeting:ns[0],questions:ns.slice(1,-2),closing:ns.at(-2)};
}
export async function readVerifiedStageAudio(env,tenantId,frozen,nodeId){
 const manifest=JSON.parse(frozen.row.manifest_json),entry=manifest.entries?.find(n=>n.nodeId===nodeId);
 if(!entry||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>1048576||!digest(entry.audioSha256))fail('school_stage_audio_missing');
 // Never accept manifest-supplied object path without deriving the expected key.
 const expected='school-pilot/v1/'+frozen.graphSha256+'/'+nodeId+'/'+entry.audioSha256+'.mp3';
 if(entry.key!==expected)fail('school_stage_audio_missing');
 const object=await env.SCHOOL_PILOT_AUDIO?.get('school-private/'+tenantId+'/'+expected);
 if(!object||object.size!==entry.bytes||object.httpMetadata?.contentType!=='audio/mpeg')fail('school_stage_audio_missing');
 const bytes=await readBoundedBytes({headers:new Headers({'content-length':String(object.size)}),body:object.body},1048576);
 await verifySchoolAudioBytes({graphJson:frozen.graphJson,graphSha256:frozen.graphSha256,manifest,
  expectedManifestSha256:frozen.row.manifest_sha256,nodeId,bytes});
 return bytes;
}
/** Only the explicitly authenticated stage operator can submit one approved staff call.
 * Reviewed reserve amounts are conservative dedicated-account envelopes, not provider
 * tariff quotes; never released automatically, including on timeout or rejection.
 */
export async function dispatchSchoolStageCall(env,user,input,{clock=Date.now,fetcher=fetch}={}){
 const c=schoolStageConfig(env),db=env.CONTROL_DB,now=clock();
 await requireSchoolPilotMfa(db,user,now);
 if(!input||Object.keys(input).length!==4||!uuid(input.tenantId)||!uuid(input.permitId)||!digest(input.manifestSha256)||
  input.confirm!=='ONE_STAGE_STAFF_CALL_AUDIO_LISTENED_AND_FUNDING_APPROVED')fail('school_stage_explicit_confirmation_required');
 const f=await readActiveSchoolPermit(env,input.tenantId,input.permitId,now);
 if(f.row.approved_by!==user.id||f.row.audio_state!=='ready'||f.row.manifest_sha256!==input.manifestSha256)
  fail('school_stage_reviewed_audio_required');
 const nodes=linearSchoolNodes(f.graph);
 for(const n of [nodes.greeting,...nodes.questions,nodes.closing])await readVerifiedStageAudio(env,input.tenantId,f,n.id);
 const claimAt=clock(),seconds=f.row.max_call_seconds;
 if(f.row.expires_at<claimAt+(seconds+15)*1000)fail('school_stage_permit_window_short');
 const reserved=await db.prepare(`INSERT INTO school_stage_dispatches(permit_id,tenant_id,provider_account,manifest_sha256,approved_by,funding_ref,plivo_reserved_usd_micros,sarvam_reserved_inr_micros,max_seconds,claimed_at)
 SELECT id,tenant_id,?,?,?,?,?,?,?,? FROM school_internal_pilot_permits
 WHERE id=? AND tenant_id=? AND stopped_at IS NULL AND expires_at>=? AND audio_state='ready' AND manifest_sha256=?
 AND NOT EXISTS(SELECT 1 FROM school_stage_dispatches WHERE permit_id=? OR provider_account<>?)
 AND NOT EXISTS(SELECT 1 FROM school_stage_dispatches d LEFT JOIN school_internal_provider_evidence e ON e.permit_id=d.permit_id WHERE d.dispatch_state IN ('claimed','unknown') OR (d.dispatch_state='submitted' AND COALESCE(e.ended,0)=0))
 AND ? >= ?+COALESCE((SELECT SUM(plivo_reserved_usd_micros) FROM school_stage_dispatches),0)
 AND ? >= ?+COALESCE((SELECT SUM(sarvam_reserved_inr_micros) FROM school_stage_dispatches),0)`)
  .bind(c.authId,input.manifestSha256,user.id,c.fundingRef,c.plivoReserve,c.sarvamReserve,seconds,claimAt,input.permitId,input.tenantId,claimAt+(seconds+15)*1000,input.manifestSha256,input.permitId,c.authId,c.plivoCap,c.plivoReserve,c.sarvamCap,c.sarvamReserve).run();
 if(reserved.meta.changes!==1)fail('school_stage_already_claimed_or_budget_exhausted');
 let submitted=false;
 try{
  const active=await readActiveSchoolPermit(env,input.tenantId,input.permitId,clock());
  const current=schoolStageConfig(env);
  if(current.authId!==c.authId||current.token!==c.token||current.origin!==c.origin||active.row.manifest_sha256!==input.manifestSha256)
   fail('school_stage_config_changed');
  const resp=await fetcher('https://api.plivo.com/v1/Account/'+c.authId+'/Call/',{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Authorization:c.authorization,'Content-Type':'application/json'},
   body:JSON.stringify({from:active.target.caller,to:active.target.recipient,answer_url:stageCallback(c,input.permitId,'answer'),
    answer_method:'GET',hangup_url:stageCallback(c,input.permitId,'hangup'),hangup_method:'GET',
    time_limit:seconds,ring_timeout:15,hangup_on_ring:seconds+15})
  });
  if([400,401,403,404,422,429].includes(resp.status)){
   await db.prepare("UPDATE school_stage_dispatches SET dispatch_state='rejected' WHERE permit_id=? AND dispatch_state='claimed'").bind(input.permitId).run();
   return {state:'rejected',retryAllowed:false,reservationRetained:true};
  }
  if(!resp.ok)fail('school_stage_submission_unknown');
  const data=JSON.parse(new TextDecoder().decode(await readBoundedBytes(resp,8192)));
  if(!uuid(data.request_uuid))fail('school_stage_submission_unknown');
  // Retain accepted evidence even if operator revoked the permit during the HTTP request.
  const result=await db.batch([
   db.prepare('INSERT INTO school_internal_provider_evidence(permit_id,request_uuid) VALUES(?,?)').bind(input.permitId,data.request_uuid),
   db.prepare("UPDATE school_stage_dispatches SET dispatch_state='submitted' WHERE permit_id=? AND dispatch_state='claimed'").bind(input.permitId)
  ]);
  if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1)fail('school_stage_submission_unknown');
  submitted=true;
  return {state:'submitted',retryAllowed:false,reservationRetained:true,maxSeconds:seconds};
 }catch{
  if(!submitted)await db.prepare("UPDATE school_stage_dispatches SET dispatch_state='unknown' WHERE permit_id=? AND dispatch_state='claimed'").bind(input.permitId).run();
  return {state:'unknown',retryAllowed:false,reservationRetained:true};
 }
}
/** Revocation first; only DELETE the exact signed call UUID from this stage account.
 * A 204 means provider accepted the request, not verified hangup completion.
 */
export async function stopSchoolStageCall(env,user,{tenantId,permitId},{clock=Date.now,fetcher=fetch}={}){
 await stopSchoolInternalPilot(env,user,tenantId,permitId,{now:clock()});
 const row=await env.CONTROL_DB.prepare('SELECT d.provider_account,d.phase,e.call_uuid,e.ended FROM school_stage_dispatches d LEFT JOIN school_internal_provider_evidence e ON e.permit_id=d.permit_id WHERE d.tenant_id=? AND d.permit_id=?').bind(tenantId,permitId).first();
 if(row?.ended)return {state:'signed_ended'};
 if(!uuid(row?.call_uuid))return {state:'revoked_call_uuid_unavailable'};
 const c=schoolStageConfig(env,{forStop:true});
 if(row.provider_account!==c.authId)fail('school_stage_account_mismatch');
 try{
  const resp=await fetcher('https://api.plivo.com/v1/Account/'+c.authId+'/Call/'+row.call_uuid+'/',{method:'DELETE',redirect:'manual',
   signal:AbortSignal.timeout(5000),headers:{Authorization:c.authorization}});
  return {state:resp.status===204?'hangup_requested':'hangup_unconfirmed'};
 }catch{return {state:'hangup_unconfirmed'}}
}
