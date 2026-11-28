// Exact notice scope; no provider call or private fields in CRM.
import {INDUSTRY_NOTICE_CONTRACTS} from './industry-verified-notice.mjs';
import {verifyFrozen} from './industry-flow-snapshots.mjs';
import {sha256hex} from './core.mjs';
import {industryActorPredicate} from './industry-dispatch-authority.mjs';
import {campaignDispatchInterlock} from './calling-dispatch-pause.mjs';

export const NOTICE_MODE='industry_notice_v1',NOTICE_SECONDS=90;
export const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
export const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const requestId=x=>typeof x==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(x);
export const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
export const reference=(x,min=4)=>typeof x==='string'&&x.trim().length>=min&&x.length<=160&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
export const iso=n=>new Date(n).toISOString();
export const contractFor=id=>INDUSTRY_NOTICE_CONTRACTS.find(x=>x.templateId===id)||null;
export const noticeJob=(db,tid,id)=>db.prepare('SELECT * FROM industry_notice_jobs WHERE tenant_id=? AND id=?').bind(tid,id).first();
export const noticeEligibility="EXISTS(SELECT 1 FROM leads l WHERE l.tenant_id=industry_notice_jobs.tenant_id AND l.id=industry_notice_jobs.lead_id AND l.mobile_e164=industry_notice_jobs.destination AND l.updated_at=industry_notice_jobs.lead_updated_at AND l.consent_status<>'denied' AND l.dnd_status<>'blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id))";
export const reviewDigest=j=>sha256hex('ar3d:notice-review:v1:'+JSON.stringify([j.tenant_id,j.id,j.lead_id,j.snapshot_id,j.graph_sha256,j.template_id,j.language,j.delivery_mode,j.destination,j.lead_updated_at,j.consent_ref,j.dnd_ref,j.provider_ref,j.private_speech_ref,j.reviewed_by,j.reviewed_at,j.review_expires_at]));
export async function readNoticeSnapshot(db,tid,id,{latest=false}={}){
 if(!uuid(tid)||!uuid(id))return null;
 const row=await db.prepare("SELECT v.*,f.revision AS current_revision,f.config_json AS current_config,r.decision FROM ai_flow_snapshots v JOIN ai_flow_definitions f ON f.tenant_id=v.tenant_id AND f.id=v.flow_id JOIN ai_flow_preview_reviews r ON r.tenant_id=v.tenant_id AND r.snapshot_id=v.id WHERE v.tenant_id=? AND v.id=? AND r.decision='simulation_reviewed'").bind(tid,id).first();
 if(!row||!contractFor(row.template_id)||latest&&(row.current_revision!==row.source_revision||row.current_config!==row.config_json))return null;
 const {config,graph}=await verifyFrozen(row);
 if(config.mode!=='announcement'||config.questions.length!==0||graph.mode!=='announcement')return null;
 return {row,config,graph,language:config.language==='en'?'en':'hi'};
}
export function noticeSessionDoc(j){
 return {notice:{version:1,jobId:j.id,templateId:j.template_id,reviewSha256:j.review_sha256,graphSha256:j.graph_sha256,deliveryMode:j.delivery_mode,language:j.language},phoneMeta:{mode:NOTICE_MODE,dispatchVersion:1,engine:'carrier_announcement',costMeterVersion:1}};
}
export function isNoticeSession(row){
 try{return JSON.parse(row.survey_json).phoneMeta?.mode===NOTICE_MODE}catch{return false}
}
export function exactNoticeSession(j,row){
 if(!j||!row||row.id!==j.session_id||row.job_id!==j.id||row.tenant_id!==j.tenant_id||row.lead_id!==j.lead_id||row.destination!==j.destination||row.lead_updated_at!==j.lead_updated_at||row.actor_id!==j.actor_id||row.language!==j.language||row.rate_slot!==null||row.turn!==0)return false;
 try{
  const d=JSON.parse(row.survey_json),expected=noticeSessionDoc(j);
  return JSON.stringify(d.notice)===JSON.stringify(expected.notice)&&d.phoneMeta?.mode===NOTICE_MODE&&d.phoneMeta?.dispatchVersion===1&&d.phoneMeta?.engine==='carrier_announcement';
 }catch{return false}
}
// Recheck current recipient, active tenant, reviewer and operator role.
// Historical billing does not use this live gate.
export async function currentNotice(env,j,now,{hold=false,session=false}={}){
 if(!j||j.revoked_at!==null||!j.actor_id||!Number.isSafeInteger(now)||j.review_expires_at<=now||j.release_expires_at<=now||await reviewDigest(j)!==j.review_sha256)return false;
 const live=await env.CRM_DB.prepare("SELECT 1 AS ok FROM industry_notice_jobs WHERE tenant_id=? AND id=? AND state=? AND updated_at=? AND revoked_at IS NULL AND "+noticeEligibility).bind(j.tenant_id,j.id,j.state,j.updated_at).first();
 if(!live)return false;
 const control=env.CONTROL_DB;
 const t=await control.prepare("SELECT t.display_name FROM tenants t JOIN human_users u ON u.id=? JOIN human_users r ON r.id=? WHERE t.id=? AND t.status='active' AND t.storage_mode='shared' AND "+industryActorPredicate+" AND r.status='active' AND r.global_role='super_admin' AND EXISTS(SELECT 1 FROM human_mfa_settings m WHERE m.user_id=r.id AND m.enabled_at IS NOT NULL)").bind(j.actor_id,j.reviewed_by,j.tenant_id).first();
 if(!t)return false;
 const gate=await campaignDispatchInterlock(control);
 if(gate.paused||gate.providerBlocked)return false;
 if(hold){
  const h=await control.prepare("SELECT h.state,h.reserved_seconds FROM tenant_minute_holds h JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE h.tenant_id=? AND h.job_id=? AND h.state='held' AND h.reserved_seconds=p.reserved_seconds").bind(j.tenant_id,j.id).first();
  if(h?.reserved_seconds!==NOTICE_SECONDS)return false;
 }
 if(session){
  const s=await control.prepare('SELECT * FROM scripted_phone_pilots WHERE id=? AND tenant_id=? AND job_id=?').bind(j.session_id,j.tenant_id,j.id).first();
  if(!exactNoticeSession(j,s)||s.hangup_at!==null||s.expires_at<=now||now>=Date.parse(s.created_at)+(NOTICE_SECONDS+25)*1000)return false;
 }
 return true;
}
